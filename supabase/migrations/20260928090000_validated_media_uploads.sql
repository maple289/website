BEGIN;
UPDATE storage.buckets SET allowed_mime_types=ARRAY['image/jpeg','image/png','image/gif','image/webp','image/bmp','image/tiff','image/heic','image/heif','image/avif'] WHERE id='user-images';
UPDATE storage.buckets SET allowed_mime_types=ARRAY['video/*','application/mxf','application/vnd.rn-realmedia'] WHERE id='user-videos';
INSERT INTO storage.buckets(id,name,public,file_size_limit)
VALUES ('media-staging','media-staging',false,10737418240)
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=10737418240;

CREATE TABLE public.media_upload_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('video','photo','preview')),
  target_video_id uuid REFERENCES public.videos(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 255),
  visibility text NOT NULL CHECK(visibility IN ('private','public')),
  has_preview boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','complete','error')),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
ALTER TABLE public.media_upload_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_upload_jobs FROM anon,authenticated;
GRANT SELECT ON public.media_upload_jobs TO authenticated;
GRANT ALL ON public.media_upload_jobs TO service_role;
CREATE POLICY media_jobs_read_own ON public.media_upload_jobs FOR SELECT TO authenticated USING(owner_id=auth.uid());
CREATE INDEX media_jobs_pending ON public.media_upload_jobs(created_at) WHERE status='queued';

CREATE FUNCTION public.queue_media_upload(p_id uuid,p_owner uuid,p_kind text,p_name text,p_visibility text,p_preview boolean DEFAULT false,p_video uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner) OR EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=p_owner AND (NOT active OR must_change_password)) THEN
    RAISE EXCEPTION 'Account is not allowed to upload';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  IF EXISTS(SELECT 1 FROM public.media_upload_jobs WHERE id=p_id AND owner_id=p_owner) THEN RETURN p_id; END IF;
  IF (SELECT count(*) FROM public.media_upload_jobs WHERE owner_id=p_owner AND status IN ('queued','processing'))>=30 THEN
    RAISE EXCEPTION 'Too many pending uploads. Wait for processing to finish.';
  END IF;
  IF p_kind='preview' AND NOT EXISTS(SELECT 1 FROM public.videos WHERE id=p_video AND owner_id=p_owner) THEN
    RAISE EXCEPTION 'Video not found or access denied';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='media-staging' AND name=p_owner::text||'/'||p_id::text||'/source') THEN
    RAISE EXCEPTION 'Upload is incomplete';
  END IF;
  INSERT INTO public.media_upload_jobs(id,owner_id,kind,target_video_id,file_name,visibility,has_preview)
  VALUES(p_id,p_owner,p_kind,p_video,btrim(p_name),p_visibility,p_preview);
  RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.queue_media_upload(uuid,uuid,text,text,text,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_media_upload(uuid,uuid,text,text,text,boolean,uuid) TO service_role;

-- These restrictive policies close every direct write route, even if an older
-- permissive policy is present. File Manager's user-files bucket is unaffected.
CREATE POLICY validated_media_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated
WITH CHECK (bucket_id NOT IN ('user-videos','user-images') AND
 (bucket_id<>'media-staging' OR (auth.uid() IS NOT NULL AND name ~ ('^'||auth.uid()::text||'/[0-9a-f-]{36}/(source|preview)$'))));
CREATE POLICY validated_media_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
USING(bucket_id NOT IN ('user-videos','user-images','media-staging'))
WITH CHECK(bucket_id NOT IN ('user-videos','user-images','media-staging'));
CREATE POLICY staging_private_read ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(bucket_id<>'media-staging' OR (auth.uid() IS NOT NULL AND (storage.foldername(name))[1]=auth.uid()::text));
CREATE POLICY staging_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK
(bucket_id='media-staging' AND (storage.foldername(name))[1]=auth.uid()::text);
CREATE POLICY staging_read_own ON storage.objects FOR SELECT TO authenticated USING
(bucket_id='media-staging' AND (storage.foldername(name))[1]=auth.uid()::text);
CREATE POLICY staging_delete_own ON storage.objects FOR DELETE TO authenticated USING
(bucket_id='media-staging' AND (storage.foldername(name))[1]=auth.uid()::text);

REVOKE INSERT ON public.videos,public.photos FROM anon,authenticated;
CREATE FUNCTION public.guard_validated_media() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Media must be validated by the upload service' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='photos' THEN
    IF (to_jsonb(NEW)-ARRAY['file_name','visibility','edit_name_key']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['file_name','visibility','edit_name_key']) THEN
      RAISE EXCEPTION 'Photo storage and processing metadata are server-managed' USING ERRCODE='42501';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['file_name','visibility','preview_path','preview_url']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['file_name','visibility','preview_path','preview_url']) THEN
      RAISE EXCEPTION 'Video storage and processing metadata are server-managed' USING ERRCODE='42501';
    END IF;
    IF NEW.preview_url IS DISTINCT FROM OLD.preview_url AND NEW.preview_url IS NOT NULL THEN
      RAISE EXCEPTION 'Use a validated preview image' USING ERRCODE='42501';
    END IF;
    IF NEW.preview_path IS DISTINCT FROM OLD.preview_path AND NEW.preview_path IS NOT NULL AND
      NOT EXISTS(SELECT 1 FROM public.media_upload_jobs j WHERE j.owner_id=auth.uid()
      AND j.kind='preview' AND j.target_video_id=NEW.id AND j.status='complete' AND j.result->>'path'=NEW.preview_path) THEN
      RAISE EXCEPTION 'Use a validated preview image' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_validated_video BEFORE INSERT OR UPDATE ON public.videos FOR EACH ROW EXECUTE FUNCTION public.guard_validated_media();
CREATE TRIGGER guard_validated_photo BEFORE INSERT OR UPDATE ON public.photos FOR EACH ROW EXECUTE FUNCTION public.guard_validated_media();
REVOKE ALL ON FUNCTION public.guard_validated_media() FROM PUBLIC,anon,authenticated;
COMMIT;
