-- PostgREST connections preload safeupdate, which rejects DELETE without WHERE.
-- Analytics invalidation runs inside the source mutation's transaction: a rejected
-- cache DELETE therefore rolls back photo/video/file removal after storage cleanup.
-- The non-null primary key predicate deliberately covers this derived cache only.
-- Keep safeupdate, the existing triggers, ownership checks and RLS unchanged.
CREATE OR REPLACE FUNCTION public.analytics_invalidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.analytics_cache WHERE key IS NOT NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_invalidate() FROM PUBLIC, anon, authenticated;

-- Ownership changes use the same cache invalidation and need the same correction.
CREATE OR REPLACE FUNCTION public.analytics_refresh_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
    UPDATE public.analytics_content SET owner_id = current_owner
      WHERE content_type = kind AND content_id = NEW.id;
  END IF;
  DELETE FROM public.analytics_cache WHERE key IS NOT NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_refresh_owner() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
