BEGIN;
-- Persistent tombstones prevent delayed workers from publishing deleted IDs.
CREATE TABLE public.video_deletions (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
ALTER TABLE public.video_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_deletions FROM anon, authenticated;
GRANT ALL ON public.video_deletions TO service_role;
ALTER TABLE public.media_upload_jobs DROP CONSTRAINT media_upload_jobs_status_check;
ALTER TABLE public.media_upload_jobs ADD CONSTRAINT media_upload_jobs_status_check
  CHECK(status IN ('queued','processing','complete','error','cancelling','cancelled'));

CREATE FUNCTION public.guard_deleted_video() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME='videos' THEN target := NEW.id;
  ELSE target := CASE WHEN NEW.kind='video' THEN NEW.id ELSE NEW.target_video_id END; END IF;
  IF target IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target::text, 71));
  IF EXISTS(SELECT 1 FROM public.video_deletions WHERE id=target) THEN
    IF TG_TABLE_NAME='media_upload_jobs' AND TG_OP='UPDATE' THEN
      -- Only the worker's final acknowledgement may release a running job.
      IF NEW.status NOT IN ('cancelling','cancelled') THEN NEW.status := OLD.status; END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Video deletion has been requested' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_deleted_video BEFORE INSERT OR UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_video();
CREATE TRIGGER guard_deleted_video_job BEFORE INSERT OR UPDATE ON public.media_upload_jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_video();

CREATE FUNCTION public.begin_video_deletion(p_id uuid,p_owner uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=p_owner AND (NOT active OR must_change_password)) THEN
    RAISE EXCEPTION 'Account is not allowed to delete' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,71));
  IF NOT EXISTS(SELECT 1 FROM public.videos WHERE id=p_id AND owner_id=p_owner)
    AND NOT EXISTS(SELECT 1 FROM public.media_upload_jobs WHERE id=p_id AND owner_id=p_owner AND kind='video')
    AND NOT EXISTS(SELECT 1 FROM public.video_deletions WHERE id=p_id AND owner_id=p_owner) THEN
    RAISE EXCEPTION 'Video not found or access denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.video_deletions(id,owner_id) VALUES(p_id,p_owner) ON CONFLICT DO NOTHING;
  UPDATE public.media_upload_jobs SET status=CASE WHEN status IN ('processing','cancelling') THEN 'cancelling' ELSE 'cancelled' END
    WHERE owner_id=p_owner AND (id=p_id OR target_video_id=p_id);
  RETURN NOT EXISTS(SELECT 1 FROM public.media_upload_jobs WHERE owner_id=p_owner
    AND (id=p_id OR target_video_id=p_id) AND status='cancelling');
END; $$;

-- Resolve actual catalog keys, including old Admin base prefixes. Never delete
-- storage catalog rows directly: the Storage API must remove the physical bytes.
CREATE FUNCTION public.video_deletion_objects(p_id uuid,p_owner uuid)
RETURNS TABLE(bucket_id text,name text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT o.bucket_id,o.name FROM storage.objects o
  WHERE EXISTS(SELECT 1 FROM public.video_deletions WHERE id=p_id AND owner_id=p_owner)
  AND (
    (o.bucket_id='user-videos' AND o.name ~ ('(^|/)'||p_owner||'/videos/'||p_id||'/'))
    OR (o.bucket_id='user-images' AND o.name ~ ('(^|/)'||p_owner||'/video-previews/'||p_id||'/'))
    OR (o.bucket_id='media-staging' AND EXISTS(SELECT 1 FROM public.media_upload_jobs j
      WHERE j.owner_id=p_owner AND (j.id=p_id OR j.target_video_id=p_id)
        AND o.name IN (p_owner||'/'||j.id||'/source',p_owner||'/'||j.id||'/preview')))
    OR EXISTS(SELECT 1 FROM public.videos v CROSS JOIN LATERAL
      (VALUES ('user-videos',v.storage_path),('user-videos',v.processed_storage_path),('user-images',v.preview_path)) AS r(bucket,path)
      WHERE v.id=p_id AND v.owner_id=p_owner AND r.path LIKE p_owner||'/%'
        AND o.bucket_id=r.bucket AND (o.name=r.path OR right(o.name,length(r.path)+1)='/'||r.path))
  ) ORDER BY o.bucket_id,o.name;
$$;
CREATE FUNCTION public.finish_video_deletion(p_id uuid,p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,71));
  IF NOT EXISTS(SELECT 1 FROM public.video_deletions WHERE id=p_id AND owner_id=p_owner) THEN
    RAISE EXCEPTION 'Deletion not authorized'; END IF;
  IF EXISTS(SELECT 1 FROM public.media_upload_jobs WHERE owner_id=p_owner AND (id=p_id OR target_video_id=p_id) AND status='cancelling')
    OR EXISTS(SELECT 1 FROM public.video_deletion_objects(p_id,p_owner)) THEN
    RAISE EXCEPTION 'Storage cleanup is not complete'; END IF;
  DELETE FROM public.videos WHERE id=p_id AND owner_id=p_owner;
  DELETE FROM public.media_upload_jobs WHERE owner_id=p_owner AND (id=p_id OR target_video_id=p_id);
  UPDATE public.video_deletions SET completed_at=now() WHERE id=p_id AND owner_id=p_owner;
END; $$;
REVOKE ALL ON FUNCTION public.guard_deleted_video(),public.begin_video_deletion(uuid,uuid),
  public.video_deletion_objects(uuid,uuid),public.finish_video_deletion(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_video_deletion(uuid,uuid),public.video_deletion_objects(uuid,uuid),public.finish_video_deletion(uuid,uuid) TO service_role;
-- Video deletion must complete storage cleanup via the authorized server route.
REVOKE DELETE ON public.videos FROM authenticated,anon;
-- Reconcile old completed jobs left by the former deletion path. Never remove
-- a job with remaining stored media: leave a retryable cleanup card instead.
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT id,owner_id FROM public.media_upload_jobs jobs
    WHERE kind='video' AND status='complete' AND NOT EXISTS(SELECT 1 FROM public.videos WHERE id=jobs.id)
  LOOP
    INSERT INTO public.video_deletions(id,owner_id) VALUES(j.id,j.owner_id) ON CONFLICT DO NOTHING;
    UPDATE public.media_upload_jobs SET status='cancelled' WHERE id=j.id;
    IF NOT EXISTS(SELECT 1 FROM public.video_deletion_objects(j.id,j.owner_id)) THEN
      PERFORM public.finish_video_deletion(j.id,j.owner_id);
    END IF;
  END LOOP;
END $$;
COMMIT;
