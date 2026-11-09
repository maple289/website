-- Accept both captured output layouts; preserve all publication/claim checks.
BEGIN;
CREATE FUNCTION public.library_worker_control() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('layout_version',layout_version,'pause_media_claims',pause_media_claims,
   'pause_library_writes',pause_library_writes) FROM streamly_internal.library_storage_control WHERE id;
$$;
ALTER FUNCTION public.library_worker_control() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.library_worker_control() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.library_worker_control() TO service_role;
CREATE OR REPLACE FUNCTION public.publish_media_upload(p_id uuid,p_claim uuid,p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.media_upload_jobs; v public.videos; p public.photos;
  outcome jsonb; required record; full_path text;
  media_bucket text; image_bucket text;
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
  media_bucket:=CASE WHEN j.output_layout=2 THEN 'users' WHEN j.kind='video' THEN 'user-videos' ELSE 'user-images' END;
  image_bucket:=CASE WHEN j.output_layout=2 THEN 'users' ELSE 'user-images' END;
  IF j.kind='preview' THEN
    IF NOT EXISTS(SELECT 1 FROM public.videos WHERE id=j.target_video_id AND owner_id=j.owner_id) THEN
      RAISE EXCEPTION 'Video no longer exists' USING ERRCODE='23503';
    END IF;
    full_path:=streamly_internal.media_object_key(image_bucket,p_record->>'path');
    IF p_record->>'path' IS DISTINCT FROM (j.owner_id||CASE WHEN j.output_layout=2 THEN '/videos/' ELSE '/video-previews/' END||j.target_video_id||'/'||j.id||'.webp')
      OR coalesce(p_record->>'bucket','user-images')<>image_bucket
      OR NOT EXISTS(SELECT 1 FROM public.videos WHERE id=j.target_video_id AND owner_id=j.owner_id AND preview_bucket=image_bucket)
      OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=image_bucket AND name=full_path AND (metadata->>'size')::bigint>0) THEN
      RAISE EXCEPTION 'Validated preview is missing' USING ERRCODE='23514';
    END IF;
    outcome:=jsonb_build_object('path',p_record->>'path');
    IF j.output_layout=2 THEN outcome:=outcome||jsonb_build_object('bucket','users'); END IF;
  ELSE
    IF (p_record->>'id')::uuid IS DISTINCT FROM j.id OR (p_record->>'owner_id')::uuid IS DISTINCT FROM j.owner_id
      OR p_record->>'visibility' IS DISTINCT FROM j.visibility OR p_record->>'file_name' IS DISTINCT FROM j.file_name THEN
      RAISE EXCEPTION 'Media publication does not match its job' USING ERRCODE='23514';
    END IF;
    IF (j.kind='video' AND ((
          (j.output_layout=1 AND starts_with(p_record->>'storage_path',j.owner_id||'/videos/'||j.id||'/original.')
            AND p_record->>'processed_storage_path'=j.owner_id||'/videos/'||j.id||'/stream.mp4')
          OR (p_record->>'storage_path'=j.owner_id||'/videos/'||j.id||'/video.mp4'
            AND p_record->>'processed_storage_path'=p_record->>'storage_path')
        ) IS NOT TRUE))
      OR (j.kind='photo' AND starts_with(p_record->>'storage_path',j.owner_id||'/photos/'||j.id||CASE WHEN j.output_layout=2 THEN '/photo.' ELSE '/original.' END) IS NOT TRUE)
      OR p_record->>'preview_path' IS DISTINCT FROM (CASE WHEN j.kind='video' THEN
        CASE WHEN j.output_layout=2 THEN j.owner_id||'/videos/'||j.id||'/thumbnail.webp' ELSE j.owner_id||'/video-previews/'||j.id||'/preview.webp' END
        ELSE j.owner_id||'/photos/'||j.id||'/preview.webp' END)
      OR (j.kind='photo' AND p_record->>'thumbnail_path' IS DISTINCT FROM j.owner_id||'/photos/'||j.id||'/thumbnail.webp') THEN
      RAISE EXCEPTION 'Media files do not belong to this upload' USING ERRCODE='23514';
    END IF;
    IF coalesce(p_record->>'storage_bucket',CASE WHEN j.kind='video' THEN 'user-videos' ELSE 'user-images' END)<>media_bucket
      OR (j.kind='video' AND coalesce(p_record->>'preview_bucket','user-images')<>image_bucket) THEN
      RAISE EXCEPTION 'Media buckets do not match the captured output layout' USING ERRCODE='23514'; END IF;
    -- Catalog checks occur only after the worker fully decodes/verifies output
    -- and Storage accepts all final files. Never publish before finalization.
    FOR required IN SELECT * FROM (VALUES
      (media_bucket,p_record->>'storage_path'),
      (media_bucket,
        CASE WHEN j.kind='video' THEN p_record->>'processed_storage_path' ELSE p_record->>'thumbnail_path' END),
      (image_bucket,p_record->>'preview_path')) r(bucket,path)
    LOOP
      full_path:=streamly_internal.media_object_key(required.bucket,required.path);
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
      IF v.storage_path=j.owner_id||'/videos/'||j.id||'/video.mp4' AND (
          v.mime_type IS DISTINCT FROM 'video/mp4' OR v.container_format IS DISTINCT FROM 'mp4'
          OR v.video_codec IS DISTINCT FROM 'h264'
          OR (v.duration_seconds>0 AND v.duration_seconds<'Infinity'::double precision) IS NOT TRUE
          OR coalesce(v.processed_file_size,0)<=0
          OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=media_bucket
            AND o.name=streamly_internal.media_object_key(media_bucket,v.processed_storage_path)
            AND o.version IS NOT NULL AND (o.metadata->>'size')::bigint=v.processed_file_size)) THEN
        RAISE EXCEPTION 'Single final MP4 is not verified' USING ERRCODE='23514';
      END IF;
      INSERT INTO public.videos(id,owner_id,owner_email,file_name,visibility,file_size,mime_type,storage_path,
        processed_storage_path,preview_path,processing_status,container_format,video_codec,video_bitrate,frame_rate,
        source_metadata,processing_action,audio_codec,audio_bitrate,processed_file_size,resolution_width,resolution_height,duration_seconds,storage_bucket,preview_bucket)
      VALUES(v.id,v.owner_id,v.owner_email,v.file_name,v.visibility,v.file_size,v.mime_type,v.storage_path,
        v.processed_storage_path,v.preview_path,v.processing_status,v.container_format,v.video_codec,v.video_bitrate,v.frame_rate,
        v.source_metadata,v.processing_action,v.audio_codec,v.audio_bitrate,v.processed_file_size,v.resolution_width,v.resolution_height,v.duration_seconds,media_bucket,image_bucket);
    ELSE
      p:=jsonb_populate_record(NULL::public.photos,p_record);
      INSERT INTO public.photos(id,owner_id,owner_email,file_name,visibility,file_size,mime_type,storage_path,preview_path,thumbnail_path,width,height,storage_bucket)
      VALUES(p.id,p.owner_id,p.owner_email,p.file_name,p.visibility,p.file_size,p.mime_type,p.storage_path,p.preview_path,p.thumbnail_path,p.width,p.height,media_bucket);
    END IF;
    outcome:=jsonb_build_object('id',j.id);
    IF j.kind='video' AND v.storage_path=j.owner_id||'/videos/'||j.id||'/video.mp4' THEN
      -- Retried source cleanup must identify the exact immutable object that
      -- passed the worker's final decode and this publication transaction.
      SELECT outcome||jsonb_build_object('final_object',jsonb_build_object(
        'id',o.id,'version',o.version,'updated_at',o.updated_at,'bucket',o.bucket_id,'path',o.name)) INTO outcome
      FROM storage.objects o WHERE o.bucket_id=media_bucket
        AND o.name=streamly_internal.media_object_key(media_bucket,v.processed_storage_path);
    END IF;
  END IF;
  UPDATE public.media_upload_jobs SET status='complete',result=outcome,error=NULL,finished_at=now() WHERE id=p_id AND claim_token=p_claim;
  RETURN outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_media_upload(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_media_upload(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION streamly_internal.media_output_objects(p_job public.media_upload_jobs)
RETURNS TABLE(bucket_id text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH locations AS (SELECT CASE WHEN p_job.output_layout=2 THEN 'users' WHEN p_job.kind='video' THEN 'user-videos' ELSE 'user-images' END AS media_bucket,
   CASE WHEN p_job.output_layout=2 THEN 'users' ELSE 'user-images' END AS image_bucket)
 SELECT o.bucket_id,o.name FROM storage.objects o CROSS JOIN locations l WHERE
   (p_job.kind IN ('video','photo') AND o.bucket_id=l.media_bucket AND starts_with(o.name,
     streamly_internal.media_object_key(l.media_bucket,p_job.owner_id||CASE WHEN p_job.kind='video' THEN '/videos/' ELSE '/photos/' END||p_job.id)||'/'))
   OR (p_job.kind='video' AND p_job.output_layout=1 AND o.bucket_id='user-images'
     AND starts_with(o.name,streamly_internal.media_object_key('user-images',p_job.owner_id||'/video-previews/'||p_job.id)||'/'))
   OR (p_job.kind='preview' AND o.bucket_id=l.image_bucket AND o.name=streamly_internal.media_object_key(l.image_bucket,
     p_job.owner_id||CASE WHEN p_job.output_layout=2 THEN '/videos/' ELSE '/video-previews/' END||p_job.target_video_id||'/'||p_job.id||'.webp'));
$$;
ALTER FUNCTION streamly_internal.media_output_objects(public.media_upload_jobs) OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.media_output_objects(public.media_upload_jobs) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.media_upload_cleanup_candidates()
RETURNS TABLE(bucket_id text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT o.bucket_id,o.name FROM public.media_upload_jobs j
 CROSS JOIN LATERAL streamly_internal.media_output_objects(j) o JOIN storage.objects actual ON actual.bucket_id=o.bucket_id AND actual.name=o.name
 WHERE j.integrity_version>=1 AND j.status='error' AND j.finished_at<now()-interval '15 minutes'
   AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_media_claims AND NOT pause_library_writes)
   AND NOT EXISTS(SELECT 1 FROM public.videos WHERE id=j.id)
   AND NOT EXISTS(SELECT 1 FROM public.photos WHERE id=j.id)
   AND NOT EXISTS(SELECT 1 FROM streamly_internal.library_media_objects current
     WHERE current.bucket_id=o.bucket_id AND current.object_path=o.name)
   AND NOT EXISTS(SELECT 1 FROM streamly_internal.storage_migration_objects a WHERE actual.id IN (a.old_object_id,a.new_object_id))
 ORDER BY j.finished_at,o.bucket_id,o.name LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.media_upload_cleanup_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.media_upload_cleanup_candidates() TO service_role;

CREATE OR REPLACE FUNCTION public.finalized_video_source_cleanup_candidates()
RETURNS TABLE(bucket_id text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT source.bucket_id,source.name FROM public.media_upload_jobs j
 JOIN public.videos v ON v.id=j.id AND v.owner_id=j.owner_id
 JOIN storage.objects final ON final.bucket_id=v.storage_bucket AND final.name=streamly_internal.media_object_key(v.storage_bucket,v.processed_storage_path)
 JOIN storage.objects source ON source.bucket_id=j.input_bucket AND source.name IN (j.input_prefix||'/source',j.input_prefix||'/preview')
 WHERE j.kind='video' AND j.integrity_version>=1 AND j.status='complete'
   AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_media_claims AND NOT pause_library_writes)
   AND j.finished_at<now()-interval '15 minutes' AND v.processing_status='ready'
   AND (source.metadata->>'size')::bigint>0 AND v.storage_path=j.owner_id||'/videos/'||j.id||'/video.mp4'
   AND v.processed_storage_path=v.storage_path AND v.container_format='mp4' AND v.mime_type='video/mp4' AND v.video_codec='h264'
   AND v.duration_seconds>0 AND v.duration_seconds<'Infinity'::double precision
   AND v.processed_file_size>0 AND (final.metadata->>'size')::bigint=v.processed_file_size
   AND final.id::text=j.result->'final_object'->>'id' AND final.version=j.result->'final_object'->>'version'
   AND final.updated_at=(j.result->'final_object'->>'updated_at')::timestamptz
   AND NOT EXISTS(SELECT 1 FROM public.video_deletions WHERE id=j.id)
   AND NOT EXISTS(SELECT 1 FROM public.media_upload_jobs pending WHERE (pending.id=j.id OR pending.target_video_id=j.id)
     AND pending.status NOT IN ('complete','cancelled'))
 ORDER BY j.finished_at,source.name LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.finalized_video_source_cleanup_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalized_video_source_cleanup_candidates() TO service_role;

CREATE OR REPLACE FUNCTION public.retry_video_processing(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.media_upload_jobs; actor uuid:=auth.uid(); layout smallint;
BEGIN
 IF NOT public.active_account(actor) THEN RAISE EXCEPTION 'Please sign in with an active account.' USING ERRCODE='42501'; END IF;
 SELECT layout_version INTO layout FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes;
 IF layout IS NULL THEN RAISE EXCEPTION 'Storage maintenance is in progress' USING ERRCODE='55000'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,71));
 SELECT * INTO j FROM public.media_upload_jobs WHERE id=p_id AND owner_id=actor AND kind='video' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Upload not found or access denied.' USING ERRCODE='42501'; END IF;
 IF j.status IN ('queued','processing') THEN RETURN; END IF;
 IF j.status<>'error' OR EXISTS(SELECT 1 FROM public.video_deletions WHERE id=p_id) THEN RAISE EXCEPTION 'This upload cannot be retried.'; END IF;
 IF EXISTS(SELECT 1 FROM public.videos WHERE id=p_id) THEN RAISE EXCEPTION 'This video is already in your gallery. Refresh My Videos.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=j.input_bucket AND name=j.input_prefix||'/source' AND (metadata->>'size')::bigint>0)
   OR j.has_preview AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=j.input_bucket AND name=j.input_prefix||'/preview' AND (metadata->>'size')::bigint>0) THEN
   RAISE EXCEPTION 'The original upload is no longer available. Please upload the file again.'; END IF;
 IF EXISTS(SELECT 1 FROM streamly_internal.media_output_objects(j)) THEN
   RAISE EXCEPTION 'Previous processing cleanup is incomplete. Delete this failed upload and upload it again.'; END IF;
 IF (SELECT count(*) FROM public.media_upload_jobs WHERE owner_id=actor AND status IN ('queued','processing'))>=30 THEN
   RAISE EXCEPTION 'Too many pending uploads. Wait for processing to finish.'; END IF;
 UPDATE public.media_upload_jobs SET status='queued',error=NULL,result=NULL,claim_token=NULL,started_at=NULL,finished_at=NULL,output_layout=layout WHERE id=p_id;
END;
$$;
ALTER FUNCTION public.retry_video_processing(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.retry_video_processing(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.retry_video_processing(uuid) TO authenticated;

-- Keep deletion's existing owner/tombstone/alias contract; resolve the input
-- bucket/key captured on each job rather than reconstructing legacy names.
DO $$
DECLARE definition text; revised text;
BEGIN
 definition:=pg_get_functiondef('public.video_deletion_objects(uuid,uuid)'::regprocedure);
 IF position('o.bucket_id=''media-staging''' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected video deletion contract'; END IF;
 revised:=replace(definition,'o.bucket_id=''media-staging''','o.bucket_id IN (''media-staging'',''staging'')');
 revised:=replace(revised,'WHERE j.owner_id=p_owner','WHERE j.owner_id=p_owner AND j.input_bucket=o.bucket_id');
 revised:=replace(revised,'p_owner||''/''||j.id||''/source''','j.input_prefix||''/source''');
 revised:=replace(revised,'p_owner||''/''||j.id||''/preview''','j.input_prefix||''/preview''');
 EXECUTE revised;
END $$;
-- A timed-out Storage request may finish after its worker/job was cancelled.
-- Serialize output catalog commits with the existing deletion lock and reject
-- uploads after the durable tombstone, including retained manifest aliases.
CREATE FUNCTION public.guard_deleted_video_output() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid; owner uuid; relative_key text; prefix text;
BEGIN
 IF NEW.bucket_id NOT IN ('users','user-videos','user-images') THEN RETURN NEW; END IF;
 SELECT a.resource_id,a.owner_id INTO target,owner FROM streamly_internal.storage_migration_objects a
 WHERE a.resource_type='video' AND ((a.old_bucket=NEW.bucket_id AND a.old_key=NEW.name)
   OR (a.new_bucket=NEW.bucket_id AND a.new_key=NEW.name)) LIMIT 1;
 IF target IS NULL THEN
   IF NEW.bucket_id='users' THEN relative_key:=NEW.name;
   ELSE
     prefix:=streamly_internal.media_object_key(NEW.bucket_id,'');
     IF prefix<>'' AND NOT starts_with(NEW.name,prefix) THEN RETURN NEW; END IF;
     relative_key:=substring(NEW.name FROM length(prefix)+1);
   END IF;
   IF split_part(relative_key,'/',2)<>(CASE WHEN NEW.bucket_id='user-images' THEN 'video-previews' ELSE 'videos' END)
     OR split_part(relative_key,'/',1)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(relative_key,'/',3)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NEW; END IF;
   owner:=split_part(relative_key,'/',1)::uuid;target:=split_part(relative_key,'/',3)::uuid;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target::text,71));
 IF EXISTS(SELECT 1 FROM public.video_deletions WHERE id=target AND owner_id=owner) THEN
   RAISE EXCEPTION 'Video deletion has been requested' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END;
$$;
ALTER FUNCTION public.guard_deleted_video_output() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_deleted_video_output() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_deleted_video_output BEFORE INSERT OR UPDATE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_video_output();
NOTIFY pgrst,'reload schema';


COMMIT;
