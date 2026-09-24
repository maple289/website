-- Everyone now includes guests. Raw metadata/storage remain inaccessible to anon.
BEGIN;
ALTER TABLE public.user_file_metadata ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX user_file_metadata_public_id ON public.user_file_metadata(public_id);
CREATE INDEX user_file_metadata_parent ON public.user_file_metadata
  ((regexp_replace(object_path, '/[^/]+$', ''))) WHERE trashed_at IS NULL;

-- Exact ancestor lookups use the existing owner/path indexes rather than
-- scanning unrelated folder trees for every result.
CREATE FUNCTION public.user_file_ancestor_paths(p_path text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT array_agg(array_to_string(parts[1:n], '/'))
  FROM (SELECT string_to_array(p_path, '/') AS parts) p,
    generate_series(2, cardinality(parts)) n;
$$;

CREATE FUNCTION public.public_file_root(p_path text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.object_path FROM public.user_file_shares s
  JOIN public.user_file_metadata m USING (owner_id, object_path)
  WHERE s.owner_id = split_part(p_path, '/', 1)::uuid
    AND s.object_path = ANY(public.user_file_ancestor_paths(p_path))
    AND s.recipient_id IS NULL AND m.trashed_at IS NULL
    AND (p_path = m.object_path OR (m.is_folder AND starts_with(p_path, m.object_path || '/')))
    AND NOT EXISTS (SELECT 1 FROM public.user_file_metadata t
      WHERE t.owner_id = split_part(p_path, '/', 1)::uuid
      AND t.object_path = ANY(public.user_file_ancestor_paths(p_path)) AND t.trashed_at IS NOT NULL
      AND (t.object_path = p_path OR (t.is_folder AND starts_with(p_path, t.object_path || '/'))))
  ORDER BY length(s.object_path), s.object_path LIMIT 1;
$$;

CREATE FUNCTION public.public_file_entry(p_id uuid, p_ancestors boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.user_file_metadata; root text; safe_path text; location text; parents jsonb;
BEGIN
  SELECT * INTO m FROM public.user_file_metadata WHERE public_id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  root := public.public_file_root(m.object_path);
  IF root IS NULL THEN RETURN NULL; END IF;
  SELECT 'public/' || coalesce(string_agg(a.public_id::text || '/', '' ORDER BY length(a.object_path)), '') || m.public_id::text,
    coalesce(string_agg(regexp_replace(a.object_path, '^.*/', ''), ' / ' ORDER BY length(a.object_path)), '')
    INTO safe_path, location FROM public.user_file_metadata a
    WHERE a.owner_id = m.owner_id AND a.object_path = ANY(public.user_file_ancestor_paths(m.object_path))
      AND a.is_folder AND starts_with(m.object_path, a.object_path || '/')
      AND (a.object_path = root OR starts_with(a.object_path, root || '/'));
  IF p_ancestors THEN
    SELECT coalesce(jsonb_agg(public.public_file_entry(a.public_id, false) ORDER BY length(a.object_path)), '[]'::jsonb)
      INTO parents FROM public.user_file_metadata a WHERE a.owner_id = m.owner_id
      AND a.object_path = ANY(public.user_file_ancestor_paths(m.object_path)) AND a.is_folder
      AND starts_with(m.object_path, a.object_path || '/')
      AND (a.object_path = root OR starts_with(a.object_path, root || '/'));
  END IF;
  RETURN jsonb_build_object('id', m.public_id, 'path', safe_path,
    'name', regexp_replace(m.object_path, '^.*/', ''), 'location', 'Public files' || CASE WHEN location = '' THEN '' ELSE ' / ' || location END,
    'isFolder', m.is_folder, 'size', m.file_size, 'mimeType', m.mime_type,
    'updatedAt', m.updated_at, 'favorite', false, 'trashedAt', NULL, 'ancestors', coalesce(parents, '[]'::jsonb));
END;
$$;

CREATE FUNCTION public.list_public_user_files(p_folder uuid DEFAULT NULL, p_query text DEFAULT '', p_offset integer DEFAULT 0)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE folder_path text;
BEGIN
  IF p_folder IS NOT NULL THEN
    SELECT object_path INTO folder_path FROM public.user_file_metadata
      WHERE public_id = p_folder AND is_folder AND public.public_file_root(object_path) IS NOT NULL;
    IF folder_path IS NULL THEN RETURN; END IF;
  END IF;
  IF trim(p_query) <> '' THEN
    RETURN QUERY SELECT public.public_file_entry(m.public_id)
      FROM public.user_file_metadata m WHERE m.trashed_at IS NULL
        AND lower(regexp_replace(m.object_path, '^.*/', '')) LIKE '%' || replace(replace(replace(lower(left(trim(p_query), 256)), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
        AND public.public_file_root(m.object_path) IS NOT NULL
      ORDER BY m.is_folder DESC, lower(regexp_replace(m.object_path, '^.*/', '')), m.public_id
      LIMIT 51 OFFSET greatest(0, p_offset);
  ELSIF p_folder IS NULL THEN
    -- Root listing starts with the small grant table, not every descendant.
    RETURN QUERY SELECT public.public_file_entry(m.public_id)
      FROM public.user_file_shares s JOIN public.user_file_metadata m USING (owner_id, object_path)
      WHERE s.recipient_id IS NULL AND m.trashed_at IS NULL
        AND m.object_path = public.public_file_root(m.object_path)
      ORDER BY m.is_folder DESC, lower(regexp_replace(m.object_path, '^.*/', '')), m.public_id
      LIMIT 51 OFFSET greatest(0, p_offset);
  ELSE
    RETURN QUERY SELECT public.public_file_entry(m.public_id)
      FROM public.user_file_metadata m WHERE m.trashed_at IS NULL
        AND regexp_replace(m.object_path, '/[^/]+$', '') = folder_path
        AND public.public_file_root(m.object_path) IS NOT NULL
      ORDER BY m.is_folder DESC, lower(regexp_replace(m.object_path, '^.*/', '')), m.public_id
      LIMIT 51 OFFSET greatest(0, p_offset);
  END IF;
END;
$$;

-- Only the server-side byte proxy may resolve an opaque ID to a storage key.
CREATE FUNCTION public.resolve_public_user_file(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT object_path FROM public.user_file_metadata WHERE public_id = p_id AND NOT is_folder
    AND public.public_file_root(object_path) IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.user_file_ancestor_paths(text), public.public_file_root(text), public.public_file_entry(uuid, boolean),
  public.resolve_public_user_file(uuid), public.list_public_user_files(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_user_files(uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_user_file(uuid) TO service_role;
COMMIT;
