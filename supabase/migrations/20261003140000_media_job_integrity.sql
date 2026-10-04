ALTER TABLE public.media_upload_jobs ADD COLUMN claim_token uuid;
-- Tag only newly queued uploads for automatic compensation. Never treat old
-- audited objects as disposable just because they are unreferenced today.
ALTER TABLE public.media_upload_jobs ADD COLUMN integrity_version smallint NOT NULL DEFAULT 0;
ALTER TABLE public.media_upload_jobs ALTER COLUMN integrity_version SET DEFAULT 1;
ALTER TABLE public.media_upload_jobs ADD CONSTRAINT media_job_target_valid
  CHECK ((kind='preview')=(target_video_id IS NOT NULL)) NOT VALID;
ALTER TABLE public.media_upload_jobs VALIDATE CONSTRAINT media_job_target_valid;
CREATE INDEX media_jobs_stale ON public.media_upload_jobs(started_at)
  WHERE status IN ('processing','cancelling');

CREATE FUNCTION public.claim_media_uploads(p_limit integer DEFAULT 2)
RETURNS SETOF public.media_upload_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Recovery is fenced: a delayed former worker cannot publish after expiry.
  UPDATE public.media_upload_jobs SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'error' END,
    claim_token=NULL,finished_at=now(),error='Processing was interrupted. Retry processing or delete this upload.'
    WHERE status IN ('processing','cancelling') AND started_at<now()-interval '3 hours';
  RETURN QUERY WITH candidates AS (
    SELECT id FROM public.media_upload_jobs WHERE status='queued' ORDER BY created_at
      LIMIT greatest(0,least(p_limit,2)) FOR UPDATE SKIP LOCKED
  ) UPDATE public.media_upload_jobs j SET status='processing',claim_token=gen_random_uuid(),
      started_at=now(),finished_at=NULL,error=NULL,result=NULL
    FROM candidates c WHERE j.id=c.id RETURNING j.*;
END;
$$;

CREATE FUNCTION public.publish_media_upload(p_id uuid,p_claim uuid,p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.media_upload_jobs; v public.videos; p public.photos;
  settings public.storage_settings; outcome jsonb; required record; full_path text;
BEGIN
  -- Match the deletion lock order before locking the job row.
  SELECT * INTO j FROM public.media_upload_jobs WHERE id=p_id;
  IF j.kind IN ('video','preview') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(j.target_video_id,j.id)::text,71));
  END IF;
  SELECT * INTO j FROM public.media_upload_jobs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR p_claim IS NULL OR j.claim_token IS DISTINCT FROM p_claim THEN
    RAISE EXCEPTION 'Media processing claim expired' USING ERRCODE='40001';
  END IF;
  IF j.status='complete' THEN RETURN j.result; END IF;
  IF j.status<>'processing' THEN RAISE EXCEPTION 'Media processing claim expired' USING ERRCODE='40001'; END IF;
  SELECT * INTO settings FROM public.storage_settings WHERE id=1;
  IF j.kind='preview' THEN
    IF NOT EXISTS(SELECT 1 FROM public.videos WHERE id=j.target_video_id AND owner_id=j.owner_id) THEN
      RAISE EXCEPTION 'Video no longer exists' USING ERRCODE='23503';
    END IF;
    full_path:=concat_ws('/',nullif(btrim(settings.images_base_path,'/'),''),p_record->>'path');
    IF p_record->>'path'<>j.owner_id||'/video-previews/'||j.target_video_id||'/'||j.id||'.webp'
      OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='user-images' AND name=full_path AND (metadata->>'size')::bigint>0) THEN
      RAISE EXCEPTION 'Validated preview is missing' USING ERRCODE='23514';
    END IF;
    outcome:=jsonb_build_object('path',p_record->>'path');
  ELSE
    IF (p_record->>'id')::uuid IS DISTINCT FROM j.id OR (p_record->>'owner_id')::uuid IS DISTINCT FROM j.owner_id
      OR p_record->>'visibility' IS DISTINCT FROM j.visibility OR p_record->>'file_name' IS DISTINCT FROM j.file_name THEN
      RAISE EXCEPTION 'Media publication does not match its job' USING ERRCODE='23514';
    END IF;
    IF NOT starts_with(p_record->>'storage_path',j.owner_id||'/'||CASE WHEN j.kind='video' THEN 'videos' ELSE 'photos' END||'/'||j.id||'/original.')
      OR p_record->>'preview_path' IS DISTINCT FROM (CASE WHEN j.kind='video' THEN j.owner_id||'/video-previews/'||j.id||'/preview.webp' ELSE j.owner_id||'/photos/'||j.id||'/preview.webp' END)
      OR (j.kind='video' AND p_record->>'processed_storage_path' IS DISTINCT FROM j.owner_id||'/videos/'||j.id||'/stream.mp4')
      OR (j.kind='photo' AND p_record->>'thumbnail_path' IS DISTINCT FROM j.owner_id||'/photos/'||j.id||'/thumbnail.webp') THEN
      RAISE EXCEPTION 'Media files do not belong to this upload' USING ERRCODE='23514';
    END IF;
    -- Catalog checks occur only after the worker fully decodes/verifies output
    -- and Storage accepts all final files. Never publish before finalization.
    FOR required IN SELECT * FROM (VALUES
      (CASE WHEN j.kind='video' THEN 'user-videos' ELSE 'user-images' END,p_record->>'storage_path'),
      (CASE WHEN j.kind='video' THEN 'user-videos' ELSE 'user-images' END,
        CASE WHEN j.kind='video' THEN p_record->>'processed_storage_path' ELSE p_record->>'thumbnail_path' END),
      ('user-images',p_record->>'preview_path')) r(bucket,path)
    LOOP
      full_path:=concat_ws('/',nullif(btrim(CASE WHEN required.bucket='user-videos' THEN settings.videos_base_path ELSE settings.images_base_path END,'/'),''),required.path);
      IF required.path IS NULL OR NOT starts_with(required.path,j.owner_id::text||'/')
        OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=required.bucket AND name=full_path AND (metadata->>'size')::bigint>0) THEN
        RAISE EXCEPTION 'Validated media files are missing' USING ERRCODE='23514';
      END IF;
    END LOOP;
    IF j.kind='video' THEN
      v:=jsonb_populate_record(NULL::public.videos,p_record);
      IF v.processing_status IS DISTINCT FROM 'ready' OR right(v.processed_storage_path,4)<>'.mp4' THEN
        RAISE EXCEPTION 'Playable MP4 has not been finalized' USING ERRCODE='23514';
      END IF;
      INSERT INTO public.videos(id,owner_id,owner_email,file_name,visibility,file_size,mime_type,storage_path,
        processed_storage_path,preview_path,processing_status,container_format,video_codec,video_bitrate,frame_rate,
        source_metadata,processing_action,audio_codec,audio_bitrate,processed_file_size,resolution_width,resolution_height,duration_seconds)
      VALUES(v.id,v.owner_id,v.owner_email,v.file_name,v.visibility,v.file_size,v.mime_type,v.storage_path,
        v.processed_storage_path,v.preview_path,v.processing_status,v.container_format,v.video_codec,v.video_bitrate,v.frame_rate,
        v.source_metadata,v.processing_action,v.audio_codec,v.audio_bitrate,v.processed_file_size,v.resolution_width,v.resolution_height,v.duration_seconds);
    ELSE
      p:=jsonb_populate_record(NULL::public.photos,p_record);
      INSERT INTO public.photos(id,owner_id,owner_email,file_name,visibility,file_size,mime_type,storage_path,preview_path,thumbnail_path,width,height)
      VALUES(p.id,p.owner_id,p.owner_email,p.file_name,p.visibility,p.file_size,p.mime_type,p.storage_path,p.preview_path,p.thumbnail_path,p.width,p.height);
    END IF;
    outcome:=jsonb_build_object('id',j.id);
  END IF;
  UPDATE public.media_upload_jobs SET status='complete',result=outcome,error=NULL,finished_at=now() WHERE id=p_id AND claim_token=p_claim;
  RETURN outcome;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_media_uploads(integer),public.publish_media_upload(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_uploads(integer),public.publish_media_upload(uuid,uuid,jsonb) TO service_role;

-- Retry compensation only for new, unpublished failed uploads. Failed video
-- staging is retained for Retry Processing. User deletion owns cancelled jobs.
CREATE FUNCTION public.media_upload_cleanup_candidates()
RETURNS TABLE(bucket_id text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT o.bucket_id,o.name FROM public.media_upload_jobs j CROSS JOIN public.storage_settings s
    JOIN storage.objects o ON (
      (j.kind='video' AND o.bucket_id='user-videos' AND starts_with(o.name,concat_ws('/',nullif(btrim(s.videos_base_path,'/'),''),j.owner_id::text,'videos',j.id::text)||'/'))
      OR (j.kind='photo' AND o.bucket_id='user-images' AND starts_with(o.name,concat_ws('/',nullif(btrim(s.images_base_path,'/'),''),j.owner_id::text,'photos',j.id::text)||'/'))
      OR (j.kind='video' AND o.bucket_id='user-images' AND starts_with(o.name,concat_ws('/',nullif(btrim(s.images_base_path,'/'),''),j.owner_id::text,'video-previews',j.id::text)||'/'))
      OR (j.kind='preview' AND o.bucket_id='user-images' AND o.name=concat_ws('/',nullif(btrim(s.images_base_path,'/'),''),j.owner_id::text,'video-previews',j.target_video_id::text,j.id||'.webp'))
    )
  WHERE s.id=1 AND j.integrity_version=1 AND j.status='error' AND j.finished_at<now()-interval '15 minutes'
    AND NOT EXISTS(SELECT 1 FROM public.videos WHERE id=j.id)
    AND NOT EXISTS(SELECT 1 FROM public.photos WHERE id=j.id)
    AND NOT EXISTS(SELECT 1 FROM public.videos v WHERE v.preview_path IS NOT NULL
      AND (o.name=v.preview_path OR right(o.name,length(v.preview_path)+1)='/'||v.preview_path))
  ORDER BY j.finished_at,o.bucket_id,o.name LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.media_upload_cleanup_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.media_upload_cleanup_candidates() TO service_role;
NOTIFY pgrst, 'reload schema';
