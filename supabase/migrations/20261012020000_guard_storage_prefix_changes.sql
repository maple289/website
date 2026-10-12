BEGIN;
CREATE FUNCTION public.guard_storage_prefix_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF btrim(NEW.videos_base_path,'/') IS DISTINCT FROM btrim(OLD.videos_base_path,'/') OR btrim(NEW.images_base_path,'/') IS DISTINCT FROM btrim(OLD.images_base_path,'/') THEN
    -- Serialize the rare configuration operation with creation/publication.
    LOCK TABLE public.media_upload_jobs,public.videos,public.photos,storage.objects IN SHARE MODE;
    IF EXISTS(SELECT 1 FROM public.videos) OR EXISTS(SELECT 1 FROM public.photos)
       OR EXISTS(SELECT 1 FROM public.media_upload_jobs)
       OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id IN ('user-videos','user-images')) THEN
      RAISE EXCEPTION 'Storage prefixes cannot change while media or processing history exists. An operator-managed storage migration is required.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_storage_prefix_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_storage_prefix BEFORE UPDATE OF videos_base_path,images_base_path ON public.storage_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_storage_prefix_change();
NOTIFY pgrst,'reload schema';
COMMIT;
