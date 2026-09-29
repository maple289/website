-- Run after the migration inside a transaction and ROLLBACK afterwards.
DO $$
DECLARE owner uuid; jid uuid := gen_random_uuid(); ready boolean;
BEGIN
  SELECT id INTO owner FROM public.profiles LIMIT 1;
  IF owner IS NULL THEN RAISE EXCEPTION 'Requires a fixture profile'; END IF;
  INSERT INTO public.media_upload_jobs(id,owner_id,kind,file_name,visibility,status)
    VALUES(jid,owner,'video','deletion-regression.mp4','private','processing');
  BEGIN
    PERFORM public.begin_video_deletion(jid,gen_random_uuid());
    RAISE EXCEPTION 'Ownership bypass';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ready := public.begin_video_deletion(jid,owner);
  IF ready THEN RAISE EXCEPTION 'Running worker was not awaited'; END IF;
  UPDATE public.media_upload_jobs SET status='complete' WHERE id=jid;
  IF (SELECT status FROM public.media_upload_jobs WHERE id=jid)<>'cancelling' THEN
    RAISE EXCEPTION 'Late worker overwrote cancellation'; END IF;
  BEGIN
    PERFORM public.finish_video_deletion(jid,owner);
    RAISE EXCEPTION 'Premature finish';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Premature finish' THEN RAISE; END IF;
  END;
  UPDATE public.media_upload_jobs SET status='cancelled' WHERE id=jid;
  IF NOT public.begin_video_deletion(jid,owner) THEN RAISE EXCEPTION 'Acknowledged job still blocked'; END IF;
  PERFORM public.finish_video_deletion(jid,owner);
  IF EXISTS(SELECT 1 FROM public.media_upload_jobs WHERE id=jid) THEN RAISE EXCEPTION 'Job remains'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.video_deletions WHERE id=jid AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'No permanent tombstone'; END IF;
  BEGIN
    INSERT INTO public.media_upload_jobs(id,owner_id,kind,file_name,visibility)
      VALUES(jid,owner,'video','late-worker.mp4','private');
    RAISE EXCEPTION 'Deleted ID reused';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM public.finish_video_deletion(jid,owner); -- Idempotent retry.
  RAISE NOTICE 'PASS: ownership, running cancellation, late completion guard, acknowledgement, cleanup, tombstone, retry';
END $$;
