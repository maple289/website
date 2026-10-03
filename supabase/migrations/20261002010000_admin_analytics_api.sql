CREATE FUNCTION public.admin_analytics(p_section text DEFAULT 'overview',p_from timestamptz DEFAULT now()-interval '30 days',p_to timestamptz DEFAULT now(),
  p_page integer DEFAULT 0,p_search text DEFAULT '',p_sort text DEFAULT '',p_direction text DEFAULT 'desc',p_owner uuid DEFAULT NULL,p_visibility text DEFAULT '',p_file_type text DEFAULT '',p_timezone text DEFAULT 'UTC',p_filter_dates boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='15s' AS $$
DECLARE result jsonb; rows jsonb; total bigint; sort_col text; direction text; query text; cache_key text; series jsonb; tops jsonb; distribution jsonb; file_types jsonb; storage_users jsonb; overview jsonb; step interval; bucket text; tz text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())) OR EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=auth.uid() AND (NOT active OR must_change_password)) THEN RAISE EXCEPTION 'Active administrator account required' USING ERRCODE='42501'; END IF;
  IF p_section IS NULL OR p_page IS NULL OR p_search IS NULL OR p_filter_dates IS NULL OR p_section NOT IN ('overview','users','user','owners','videos','photos','files','storage','activity') OR p_page<0 OR p_page>100000 OR length(p_search)>256 OR p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '366 days' THEN RAISE EXCEPTION 'Invalid statistics filters' USING ERRCODE='22023'; END IF;
  tz:=CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN p_timezone ELSE 'UTC' END;
  direction:=CASE WHEN p_direction='asc' THEN 'ASC' ELSE 'DESC' END;
  IF p_section='owners' THEN
    SELECT count(*) INTO total FROM public.profiles WHERE position(lower(p_search) IN lower(coalesce(email,'')||' '||coalesce(first_name,'')||' '||coalesce(last_name,'')))>0;
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO rows FROM(SELECT id,email,coalesce(nullif(concat_ws(' ',nullif(first_name,''),nullif(last_name,'')),''),email) AS name
      FROM public.profiles WHERE position(lower(p_search) IN lower(coalesce(email,'')||' '||coalesce(first_name,'')||' '||coalesce(last_name,'')))>0 ORDER BY lower(email),id LIMIT 25 OFFSET p_page*25) r;
    RETURN jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',25);
  END IF;
  IF p_section='storage' THEN RETURN jsonb_build_object('storage',(SELECT to_jsonb(s)-'id' FROM public.analytics_storage_snapshot s),'database_bytes',pg_database_size(current_database())); END IF;
  IF p_section IN ('overview','user') THEN
    cache_key:=p_section||':'||coalesce(p_owner::text,'all')||':'||p_from::text||':'||p_to::text||':'||tz||':'||direction;
    SELECT data INTO result FROM public.analytics_cache WHERE analytics_cache.key=cache_key AND expires_at>now();
    IF result IS NOT NULL THEN RETURN result; END IF;
    SELECT jsonb_build_object('users',(SELECT count(*) FROM public.profiles),'active_users',(SELECT count(*) FROM public.analytics_users WHERE status='Active' AND last_activity>now()-interval '30 days'),
      'videos',count(*) FILTER(WHERE content_type='video'),'photos',count(*) FILTER(WHERE content_type='photo'),'files',count(*) FILTER(WHERE content_type='file'),
      'video_views',coalesce(sum(views) FILTER(WHERE content_type='video'),0),'photo_views',coalesce(sum(views) FILTER(WHERE content_type='photo'),0),
      'file_previews',coalesce(sum(previews),0),'file_downloads',coalesce(sum(downloads),0),
      'uploads_today',count(*) FILTER(WHERE uploaded_at>=date_trunc('day',now() AT TIME ZONE tz) AT TIME ZONE tz),
      'uploads_week',count(*) FILTER(WHERE uploaded_at>=date_trunc('week',now() AT TIME ZONE tz) AT TIME ZONE tz),
      'uploads_month',count(*) FILTER(WHERE uploaded_at>=date_trunc('month',now() AT TIME ZONE tz) AT TIME ZONE tz)) INTO overview
      FROM public.analytics_catalog WHERE p_owner IS NULL OR owner_id=p_owner;
    bucket:=CASE WHEN p_to-p_from<=interval '2 days' THEN 'hour' ELSE 'day' END; step:=CASE WHEN bucket='hour' THEN interval '1 hour' ELSE interval '1 day' END;
    WITH dates AS (SELECT generate_series(date_trunc(bucket,p_from AT TIME ZONE tz),date_trunc(bucket,(p_to-interval '1 microsecond') AT TIME ZONE tz),step) AS stamp),
    uploads AS(SELECT date_trunc(bucket,uploaded_at AT TIME ZONE tz) AS stamp,content_type,count(*) AS n FROM public.analytics_catalog WHERE uploaded_at>=p_from AND uploaded_at<p_to AND (p_owner IS NULL OR owner_id=p_owner) GROUP BY 1,2),
    views AS(SELECT date_trunc(bucket,e.occurred_at AT TIME ZONE tz) AS stamp,e.content_type,count(*) AS n FROM public.analytics_events e JOIN public.analytics_catalog c USING(content_type,content_id)
      WHERE e.occurred_at>=p_from AND e.occurred_at<p_to AND e.action IN ('view','preview') AND (p_owner IS NULL OR c.owner_id=p_owner) GROUP BY 1,2)
    SELECT coalesce(jsonb_agg(jsonb_build_object('date',d.stamp,'video_uploads',coalesce(uv.n,0),'photo_uploads',coalesce(up.n,0),'file_uploads',coalesce(uf.n,0),
      'video_views',coalesce(vv.n,0),'photo_views',coalesce(vp.n,0),'file_views',coalesce(vf.n,0)) ORDER BY d.stamp),'[]'::jsonb) INTO series FROM dates d
      LEFT JOIN uploads uv ON uv.stamp=d.stamp AND uv.content_type='video' LEFT JOIN uploads up ON up.stamp=d.stamp AND up.content_type='photo' LEFT JOIN uploads uf ON uf.stamp=d.stamp AND uf.content_type='file'
      LEFT JOIN views vv ON vv.stamp=d.stamp AND vv.content_type='video' LEFT JOIN views vp ON vp.stamp=d.stamp AND vp.content_type='photo' LEFT JOIN views vf ON vf.stamp=d.stamp AND vf.content_type='file';
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO distribution FROM(SELECT content_type AS label,count(*) AS value FROM public.analytics_catalog WHERE p_owner IS NULL OR owner_id=p_owner GROUP BY content_type) r;
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO file_types FROM(SELECT file_type AS label,count(*) AS value FROM public.analytics_catalog WHERE content_type='file' AND (p_owner IS NULL OR owner_id=p_owner) GROUP BY file_type ORDER BY value DESC) r;
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO storage_users FROM(SELECT id,display_name AS label,total_storage AS value,video_storage,photo_storage,file_storage FROM public.analytics_users WHERE p_owner IS NULL OR id=p_owner ORDER BY CASE WHEN p_direction='asc' THEN total_storage END ASC,CASE WHEN p_direction<>'asc' THEN total_storage END DESC,id LIMIT 100) r;
    SELECT jsonb_object_agg(kind,items) INTO tops FROM(SELECT kind,(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM(SELECT content_id AS id,name AS label,CASE WHEN kind='file' THEN previews+downloads ELSE views END AS value FROM public.analytics_catalog WHERE content_type=kind AND (p_owner IS NULL OR owner_id=p_owner) ORDER BY value DESC,content_id LIMIT 10) r) AS items FROM unnest(ARRAY['video','photo','file']) kind) t;
    result:=jsonb_build_object('overview',overview,'series',series,'distribution',distribution,'file_types',file_types,'storage_by_user',storage_users,'top',tops,
      'storage',(SELECT to_jsonb(s)-'id' FROM public.analytics_storage_snapshot s),'tracking_started_at',(SELECT tracking_started_at FROM public.analytics_config),
      'largest_files',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM(SELECT content_id AS id,name AS label,file_size AS value FROM public.analytics_catalog WHERE content_type='file' AND (p_owner IS NULL OR owner_id=p_owner) ORDER BY file_size DESC,content_id LIMIT 10) r),
      'user',(SELECT to_jsonb(u) FROM public.analytics_users u WHERE id=p_owner),'generated_at',now(),'timezone',tz);
    DELETE FROM public.analytics_cache WHERE expires_at<now();
    INSERT INTO public.analytics_cache VALUES(cache_key,now()+interval '30 seconds',result) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at,data=excluded.data;
    RETURN result;
  END IF;
  IF p_section='users' THEN
    sort_col:=CASE WHEN p_sort IN ('username','display_name','email','created_at','last_login','last_activity','total_storage','videos','photos','files','uploads','views') THEN p_sort ELSE 'total_storage' END;
    SELECT count(*) INTO total FROM public.analytics_users WHERE position(lower(p_search) IN lower(display_name||' '||coalesce(email,'')))>0;
    query:=format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM(SELECT * FROM public.analytics_users WHERE position(lower($1) IN lower(display_name||'' ''||coalesce(email,'''')))>0 ORDER BY %I %s NULLS LAST,id LIMIT 25 OFFSET $2) r',sort_col,direction);
    EXECUTE query INTO rows USING p_search,p_page*25;
  ELSIF p_section='activity' THEN
    SELECT count(*) INTO total FROM public.analytics_activity e LEFT JOIN public.profiles p ON p.id=e.actor_id
      WHERE e.occurred_at>=p_from AND e.occurred_at<p_to AND (p_owner IS NULL OR e.actor_id=p_owner) AND position(lower(p_search) IN lower(coalesce(p.email,'Anonymous')||' '||coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')||' '||e.action))>0;
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO rows FROM(SELECT e.id,e.occurred_at,e.action,
      coalesce(nullif(concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')),''),p.email,'Anonymous') AS username,
      coalesce(e.content_type,CASE WHEN e.folder_id IS NOT NULL THEN 'file/folder' WHEN e.account_id IS NOT NULL THEN 'user' ELSE 'account' END) AS content_type,
      coalesce(c.name,regexp_replace(m.object_path,'^.*/',''),ap.email,'вЂ”') AS name
      FROM public.analytics_activity e LEFT JOIN public.profiles p ON p.id=e.actor_id LEFT JOIN public.analytics_catalog c USING(content_type,content_id)
      LEFT JOIN public.user_file_metadata m ON m.public_id=e.folder_id LEFT JOIN public.profiles ap ON ap.id=e.account_id
      WHERE e.occurred_at>=p_from AND e.occurred_at<p_to AND (p_owner IS NULL OR e.actor_id=p_owner) AND position(lower(p_search) IN lower(coalesce(p.email,'Anonymous')||' '||coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')||' '||e.action))>0
      ORDER BY e.occurred_at DESC,e.id DESC LIMIT 25 OFFSET p_page*25) r;
  ELSE
    sort_col:=CASE WHEN p_sort IN ('name','created_at','file_size','processed_file_size','views','previews','downloads','last_viewed_at','last_accessed_at','owner','reactions') THEN p_sort ELSE 'created_at' END;
    SELECT count(*) INTO total FROM public.analytics_catalog c LEFT JOIN public.profiles p ON p.id=c.owner_id
      WHERE c.content_type=CASE p_section WHEN 'videos' THEN 'video' WHEN 'photos' THEN 'photo' ELSE 'file' END
      AND (p_owner IS NULL OR c.owner_id=p_owner) AND (p_visibility='' OR c.visibility=p_visibility) AND (p_file_type='' OR c.file_type=p_file_type)
      AND (NOT p_filter_dates OR (c.created_at>=p_from AND c.created_at<p_to))
      AND position(lower(p_search) IN lower(c.name||' '||coalesce(p.email,'')||' '||coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')))>0;
    query:=format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM(SELECT c.*,coalesce(nullif(concat_ws('' '',nullif(p.first_name,''''),nullif(p.last_name,'''')),''''),p.email) AS owner FROM public.analytics_catalog c LEFT JOIN public.profiles p ON p.id=c.owner_id WHERE c.content_type=$1 AND ($2 IS NULL OR c.owner_id=$2) AND ($3='''' OR c.visibility=$3) AND ($4='''' OR c.file_type=$4) AND position(lower($5) IN lower(c.name||'' ''||coalesce(p.email,'''')||'' ''||coalesce(p.first_name,'''')||'' ''||coalesce(p.last_name,'''')))>0 AND (NOT $7 OR (c.created_at>=$8 AND c.created_at<$9)) ORDER BY %I %s NULLS LAST,c.content_id LIMIT 25 OFFSET $6) r',sort_col,direction);
    EXECUTE query INTO rows USING CASE p_section WHEN 'videos' THEN 'video' WHEN 'photos' THEN 'photo' ELSE 'file' END,p_owner,p_visibility,p_file_type,p_search,p_page*25,p_filter_dates,p_from,p_to;
  END IF;
  RETURN jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',25);
END; $$;
REVOKE ALL ON FUNCTION public.admin_analytics(text,timestamptz,timestamptz,integer,text,text,text,uuid,text,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_analytics(text,timestamptz,timestamptz,integer,text,text,text,uuid,text,text,text,boolean) TO authenticated;

-- Cached aggregate queries are short-lived, but a removed source must disappear
-- immediately. Only invalidate; never log a deletion or change its behavior.
CREATE FUNCTION public.analytics_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN DELETE FROM public.analytics_cache; RETURN NULL; END; $$;
REVOKE ALL ON FUNCTION public.analytics_invalidate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER analytics_cache_source AFTER DELETE ON public.analytics_content FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_invalidate();
CREATE TRIGGER analytics_cache_trash AFTER UPDATE OF trashed_at ON public.user_file_metadata FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_invalidate();
NOTIFY pgrst,'reload schema';
