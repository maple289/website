-- Personal statistics reuse the current-content registry and counters. All
-- identity comes from auth.uid(); there is deliberately no owner/user argument.
-- Payload sizes exclude preview caches, thumbnails and processing scratch.
CREATE VIEW public.analytics_personal_catalog AS
SELECT c.* FROM public.analytics_catalog c
WHERE (c.content_type = 'video' AND EXISTS (SELECT 1 FROM public.videos v WHERE v.id = c.content_id AND v.owner_id = c.owner_id))
   OR (c.content_type = 'photo' AND EXISTS (SELECT 1 FROM public.photos p WHERE p.id = c.content_id AND p.owner_id = c.owner_id))
   OR (c.content_type = 'file' AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.id = c.content_id AND split_part(o.name, '/', 1) = c.owner_id::text));
REVOKE ALL ON public.analytics_personal_catalog FROM PUBLIC, anon, authenticated;

-- Ownership is still changed only through the existing authorized operations.
-- Keep derived counters attached to their current owner and invalidate old
-- responses in the same transaction, including the administrator summaries.
CREATE FUNCTION public.analytics_refresh_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_owner uuid; kind text;
BEGIN
  IF TG_TABLE_SCHEMA = 'storage' THEN
    SELECT id INTO current_owner FROM public.profiles WHERE id::text = split_part(NEW.name, '/', 1);
    kind := 'file';
  ELSE
    current_owner := NEW.owner_id;
    kind := CASE TG_TABLE_NAME WHEN 'videos' THEN 'video' ELSE 'photo' END;
  END IF;
  IF current_owner IS NOT NULL THEN
    UPDATE public.analytics_content SET owner_id = current_owner WHERE content_type = kind AND content_id = NEW.id;
  END IF;
  DELETE FROM public.analytics_cache;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.analytics_refresh_owner() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER analytics_video_owner AFTER UPDATE OF owner_id ON public.videos FOR EACH ROW
  WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id) EXECUTE FUNCTION public.analytics_refresh_owner();
CREATE TRIGGER analytics_photo_owner AFTER UPDATE OF owner_id ON public.photos FOR EACH ROW
  WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id) EXECUTE FUNCTION public.analytics_refresh_owner();
CREATE TRIGGER analytics_file_owner AFTER UPDATE OF name ON storage.objects FOR EACH ROW
  WHEN (OLD.bucket_id = 'user-files' AND split_part(OLD.name, '/', 1) IS DISTINCT FROM split_part(NEW.name, '/', 1)) EXECUTE FUNCTION public.analytics_refresh_owner();

CREATE VIEW public.analytics_personal_storage AS
WITH media_paths AS (
  SELECT v.owner_id, 'Videos'::text AS category, 'user-videos'::text AS bucket_id,
    concat_ws('/', nullif(trim(s.videos_base_path, '/'), ''), k.path) AS name, k.bytes
  FROM public.videos v LEFT JOIN public.storage_settings s ON s.id = 1
  CROSS JOIN LATERAL (VALUES (v.storage_path, v.file_size), (v.processed_storage_path, v.processed_file_size)) k(path, bytes)
  WHERE k.path IS NOT NULL
  UNION ALL
  SELECT p.owner_id, 'Photos', 'user-images',
    concat_ws('/', nullif(trim(s.images_base_path, '/'), ''), p.storage_path), p.file_size
  FROM public.photos p LEFT JOIN public.storage_settings s ON s.id = 1
  WHERE p.storage_path IS NOT NULL
), unique_paths AS (
  SELECT owner_id, category, bucket_id, name, max(bytes) AS bytes
  FROM media_paths GROUP BY owner_id, category, bucket_id, name
)
SELECT p.owner_id, p.category, sum(greatest(0, coalesce((o.metadata->>'size')::bigint, p.bytes, 0))) AS bytes
FROM unique_paths p JOIN storage.objects o ON o.bucket_id = p.bucket_id AND o.name = p.name
GROUP BY p.owner_id, p.category
UNION ALL
SELECT owner_id, 'Files', sum(greatest(0, file_size))
FROM public.analytics_personal_catalog WHERE content_type = 'file' GROUP BY owner_id;
REVOKE ALL ON public.analytics_personal_storage FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.user_analytics(
  p_section text DEFAULT 'overview', p_from timestamptz DEFAULT now() - interval '30 days', p_to timestamptz DEFAULT now(),
  p_page integer DEFAULT 0, p_search text DEFAULT '', p_sort text DEFAULT '', p_direction text DEFAULT 'desc',
  p_visibility text DEFAULT '', p_file_type text DEFAULT '', p_timezone text DEFAULT 'UTC', p_filter_dates boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '15s' AS $$
DECLARE
  account uuid := auth.uid(); result jsonb; rows jsonb; total bigint;
  overview jsonb; series jsonb; storage_totals jsonb; file_types jsonb; tops jsonb; reacted jsonb;
  cache_key text; tz text; bucket text; step interval; kind text; sort_col text; direction text; projection text; query text;
BEGIN
  -- Recheck account state before even reading a cached response.
  IF account IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE u.id = account AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) OR EXISTS (
    SELECT 1 FROM public.account_activation WHERE user_id = account AND (NOT active OR must_change_password)
  ) THEN RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501'; END IF;
  IF p_section IS NULL OR p_section NOT IN ('overview', 'videos', 'photos', 'files')
    OR p_page IS NULL OR p_page < 0 OR p_page > 100000 OR p_search IS NULL OR length(p_search) > 256
    OR p_filter_dates IS NULL OR p_direction IS NULL OR p_direction NOT IN ('asc', 'desc')
    OR p_visibility IS NULL OR p_visibility NOT IN ('', 'private', 'public', 'shared')
    OR p_file_type IS NULL OR p_file_type NOT IN ('', 'pdf', 'word', 'excel', 'powerpoint', 'image', 'text', 'csv', 'archive', 'other')
    OR p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days'
  THEN RAISE EXCEPTION 'Invalid statistics filters' USING ERRCODE = '22023'; END IF;
  tz := CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN p_timezone ELSE 'UTC' END;
  direction := CASE WHEN p_direction = 'asc' THEN 'ASC' ELSE 'DESC' END;

  IF p_section = 'overview' THEN
    -- Cache namespace cannot overlap the administrator cache or another user.
    cache_key := 'personal-v1:' || account::text || ':' || p_from::text || ':' || p_to::text || ':' || tz;
    SELECT data INTO result FROM public.analytics_cache WHERE key = cache_key AND expires_at > now();
    IF result IS NOT NULL THEN RETURN result; END IF;
    SELECT jsonb_build_object(
      'videos', count(*) FILTER (WHERE content_type = 'video'), 'photos', count(*) FILTER (WHERE content_type = 'photo'),
      'files', count(*) FILTER (WHERE content_type = 'file'),
      'video_views', coalesce(sum(views) FILTER (WHERE content_type = 'video'), 0),
      'photo_views', coalesce(sum(views) FILTER (WHERE content_type = 'photo'), 0),
      'file_previews', coalesce(sum(previews) FILTER (WHERE content_type = 'file'), 0),
      'file_downloads', coalesce(sum(downloads) FILTER (WHERE content_type = 'file'), 0),
      'reactions', coalesce(sum(reactions) FILTER (WHERE content_type IN ('video', 'photo')), 0),
      'uploads_month', count(*) FILTER (WHERE uploaded_at >= date_trunc('month', now() AT TIME ZONE tz) AT TIME ZONE tz)
    ) INTO overview FROM public.analytics_personal_catalog WHERE owner_id = account;
    SELECT jsonb_agg(jsonb_build_object('label', category, 'value', bytes) ORDER BY ordinal) INTO storage_totals
    FROM (SELECT categories.category, categories.ordinal, coalesce(sum(p.bytes), 0) AS bytes
      FROM (VALUES ('Videos', 1), ('Photos', 2), ('Files', 3)) categories(category, ordinal)
      LEFT JOIN public.analytics_personal_storage p ON p.owner_id = account AND p.category = categories.category
      GROUP BY categories.category, categories.ordinal) s;
    overview := overview || jsonb_build_object('storage_used', (SELECT coalesce(sum(bytes), 0) FROM public.analytics_personal_storage WHERE owner_id = account));

    bucket := CASE WHEN p_to - p_from <= interval '2 days' THEN 'hour' ELSE 'day' END;
    step := CASE WHEN bucket = 'hour' THEN interval '1 hour' ELSE interval '1 day' END;
    WITH dates AS (
      SELECT generate_series(date_trunc(bucket, p_from AT TIME ZONE tz), date_trunc(bucket, (p_to - interval '1 microsecond') AT TIME ZONE tz), step) AS stamp
    ), uploads AS (
      SELECT date_trunc(bucket, uploaded_at AT TIME ZONE tz) AS stamp, content_type, count(*) AS n
      FROM public.analytics_personal_catalog WHERE owner_id = account AND uploaded_at >= p_from AND uploaded_at < p_to GROUP BY 1, 2
    ), views AS (
      SELECT date_trunc(bucket, e.occurred_at AT TIME ZONE tz) AS stamp, e.content_type, count(*) AS n
      FROM public.analytics_events e JOIN public.analytics_personal_catalog c USING (content_type, content_id)
      WHERE c.owner_id = account AND e.occurred_at >= p_from AND e.occurred_at < p_to
        AND e.action IN ('view', 'preview', 'download') GROUP BY 1, 2
    ) SELECT coalesce(jsonb_agg(jsonb_build_object(
      'date', d.stamp, 'video_uploads', coalesce(uv.n, 0), 'photo_uploads', coalesce(up.n, 0), 'file_uploads', coalesce(uf.n, 0),
      'video_views', coalesce(vv.n, 0), 'photo_views', coalesce(vp.n, 0), 'file_views', coalesce(vf.n, 0)
    ) ORDER BY d.stamp), '[]'::jsonb) INTO series FROM dates d
    LEFT JOIN uploads uv ON uv.stamp = d.stamp AND uv.content_type = 'video'
    LEFT JOIN uploads up ON up.stamp = d.stamp AND up.content_type = 'photo'
    LEFT JOIN uploads uf ON uf.stamp = d.stamp AND uf.content_type = 'file'
    LEFT JOIN views vv ON vv.stamp = d.stamp AND vv.content_type = 'video'
    LEFT JOIN views vp ON vp.stamp = d.stamp AND vp.content_type = 'photo'
    LEFT JOIN views vf ON vf.stamp = d.stamp AND vf.content_type = 'file';
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO file_types FROM (
      SELECT file_type AS label, count(*) AS value FROM public.analytics_personal_catalog
      WHERE owner_id = account AND content_type = 'file' GROUP BY file_type ORDER BY value DESC, file_type
    ) r;
    SELECT jsonb_object_agg(content_kind, items) INTO tops FROM (
      SELECT content_kind, (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (
        SELECT content_id AS id, name AS label, CASE WHEN content_kind = 'file' THEN previews + downloads ELSE views END AS value
        FROM public.analytics_personal_catalog WHERE owner_id = account AND content_type = content_kind
        ORDER BY value DESC, content_id LIMIT 10
      ) r) AS items FROM unnest(ARRAY['video', 'photo', 'file']) AS kinds(content_kind)
    ) t;
    SELECT jsonb_object_agg(content_kind, items) INTO reacted FROM (
      SELECT content_kind, (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (
        SELECT content_id AS id, name AS label, reactions AS value FROM public.analytics_personal_catalog
        WHERE owner_id = account AND content_type = content_kind AND reactions > 0
        ORDER BY reactions DESC, content_id LIMIT 10
      ) r) AS items FROM unnest(ARRAY['video', 'photo']) AS kinds(content_kind)
    ) t;
    -- Explicit response whitelist: no profile/viewer identities, storage paths,
    -- system inventories, activity records or global statistics are returned.
    result := jsonb_build_object('overview', overview, 'series', series, 'personal_storage', storage_totals,
      'file_types', file_types, 'top', tops, 'most_reacted', reacted,
      'generated_at', now(), 'timezone', tz);
    DELETE FROM public.analytics_cache WHERE expires_at < now();
    INSERT INTO public.analytics_cache VALUES (cache_key, now() + interval '30 seconds', result)
      ON CONFLICT (key) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data;
    RETURN result;
  END IF;

  kind := CASE p_section WHEN 'videos' THEN 'video' WHEN 'photos' THEN 'photo' ELSE 'file' END;
  IF p_section = 'files' THEN
    sort_col := CASE WHEN p_sort IN ('name', 'created_at', 'file_size', 'previews', 'downloads', 'last_accessed_at') THEN p_sort ELSE 'created_at' END;
    projection := 'c.content_id AS id, c.name, c.file_type, c.extension, c.created_at, c.file_size, c.visibility, c.shared, c.previews, c.downloads, c.last_accessed_at';
  ELSE
    sort_col := CASE WHEN p_sort IN ('name', 'created_at', 'file_size', 'views', 'reactions', 'last_viewed_at') THEN p_sort ELSE 'created_at' END;
    projection := 'c.content_id AS id, c.name, c.created_at, c.file_size, c.duration_seconds, c.visibility, c.shared, c.status, c.views, c.reactions, c.last_viewed_at';
  END IF;
  SELECT count(*) INTO total FROM public.analytics_personal_catalog c
  WHERE c.owner_id = account AND c.content_type = kind
    AND (p_visibility = '' OR c.visibility = p_visibility) AND (p_file_type = '' OR c.file_type = p_file_type)
    AND position(lower(p_search) IN lower(c.name)) > 0
    AND (NOT p_filter_dates OR (c.created_at >= p_from AND c.created_at < p_to));
  query := format('SELECT coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) FROM (
    SELECT %s FROM public.analytics_personal_catalog c WHERE c.owner_id = $1 AND c.content_type = $2
      AND ($3 = '''' OR c.visibility = $3) AND ($4 = '''' OR c.file_type = $4)
      AND position(lower($5) IN lower(c.name)) > 0 AND (NOT $7 OR (c.created_at >= $8 AND c.created_at < $9))
    ORDER BY c.%I %s NULLS LAST, c.content_id LIMIT 25 OFFSET $6) r', projection, sort_col, direction);
  EXECUTE query INTO rows USING account, kind, p_visibility, p_file_type, p_search, p_page * 25, p_filter_dates, p_from, p_to;
  RETURN jsonb_build_object('rows', rows, 'total', total, 'page', p_page, 'page_size', 25);
END; $$;
REVOKE ALL ON FUNCTION public.user_analytics(text,timestamptz,timestamptz,integer,text,text,text,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_analytics(text,timestamptz,timestamptz,integer,text,text,text,text,text,text,boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
