-- Run in a transaction and ROLLBACK. Staged fixture objects have no physical bytes.
DO $$
DECLARE owner uuid; jid uuid := gen_random_uuid();
BEGIN
  SELECT p.id INTO owner FROM public.profiles p
    WHERE NOT EXISTS(SELECT 1 FROM public.account_activation a WHERE a.user_id=p.id
      AND (NOT a.active OR a.must_change_password)) LIMIT 1;
  IF owner IS NULL THEN RAISE EXCEPTION 'Requires an active fixture profile'; END IF;
  INSERT INTO public.media_upload_jobs(id,owner_id,kind,file_name,visibility,status)
    VALUES(jid,owner,'video','retry-regression.mp4','private','error');
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  BEGIN
    PERFORM public.retry_video_processing(jid);
    RAISE EXCEPTION 'Ownership bypass';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',owner::text,true);
  BEGIN
    PERFORM public.retry_video_processing(jid);
    RAISE EXCEPTION 'Missing original accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Missing original accepted' THEN RAISE; END IF;
  END;
  INSERT INTO storage.objects(bucket_id,name) VALUES('media-staging',owner||'/'||jid||'/source');
  PERFORM public.retry_video_processing(jid);
  IF (SELECT status FROM public.media_upload_jobs WHERE id=jid)<>'queued' THEN
    RAISE EXCEPTION 'Retry did not queue'; END IF;
  PERFORM public.retry_video_processing(jid); -- Repeated request is idempotent.
  PERFORM public.begin_video_deletion(jid,owner);
  BEGIN
    PERFORM public.retry_video_processing(jid);
    RAISE EXCEPTION 'Deleted upload accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Deleted upload accepted' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: retry ownership, retained original, queueing, idempotency, deletion guard';
END $$;
