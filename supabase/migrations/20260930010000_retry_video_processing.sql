BEGIN;
CREATE FUNCTION public.retry_video_processing(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.media_upload_jobs%ROWTYPE; actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL OR EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=actor_id AND (NOT active OR must_change_password)) THEN
    RAISE EXCEPTION 'Please sign in with an active account.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,71));
  SELECT * INTO j FROM public.media_upload_jobs WHERE id=p_id AND owner_id=actor_id AND kind='video' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Upload not found or access denied.' USING ERRCODE='42501'; END IF;
  IF j.status IN ('queued','processing') THEN RETURN; END IF;
  IF j.status<>'error' OR EXISTS(SELECT 1 FROM public.video_deletions WHERE id=p_id) THEN
    RAISE EXCEPTION 'This upload cannot be retried.'; END IF;
  IF EXISTS(SELECT 1 FROM public.videos WHERE id=p_id) THEN
    RAISE EXCEPTION 'This video is already in your gallery. Refresh My Videos.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='media-staging' AND name=actor_id||'/'||p_id||'/source')
    OR (j.has_preview AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='media-staging' AND name=actor_id||'/'||p_id||'/preview')) THEN
    RAISE EXCEPTION 'The original upload is no longer available. Please upload the file again.'; END IF;
  IF EXISTS(SELECT 1 FROM storage.objects WHERE
    (bucket_id='user-videos' AND name ~ ('(^|/)'||actor_id||'/videos/'||p_id||'/'))
    OR (bucket_id='user-images' AND name ~ ('(^|/)'||actor_id||'/video-previews/'||p_id||'/'))) THEN
    RAISE EXCEPTION 'Previous processing cleanup is incomplete. Delete this failed upload and upload it again.'; END IF;
  IF (SELECT count(*) FROM public.media_upload_jobs WHERE owner_id=actor_id AND status IN ('queued','processing'))>=30 THEN
    RAISE EXCEPTION 'Too many pending uploads. Wait for processing to finish.'; END IF;
  UPDATE public.media_upload_jobs SET status='queued',error=NULL,result=NULL,started_at=NULL,finished_at=NULL WHERE id=p_id;
END; $$;
REVOKE ALL ON FUNCTION public.retry_video_processing(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.retry_video_processing(uuid) TO authenticated;
COMMIT;
