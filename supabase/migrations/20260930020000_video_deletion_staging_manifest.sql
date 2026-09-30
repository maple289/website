BEGIN;
ALTER TABLE public.video_deletions ADD COLUMN staging_ids uuid[] NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION public.begin_video_deletion(p_id uuid,p_owner uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=p_owner AND (NOT active OR must_change_password)) THEN
    RAISE EXCEPTION 'Account is not allowed to delete' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,71));
  IF NOT EXISTS(SELECT 1 FROM public.videos WHERE id=p_id AND owner_id=p_owner)
    AND NOT EXISTS(SELECT 1 FROM public.media_upload_jobs WHERE id=p_id AND owner_id=p_owner AND kind='video')
    AND NOT EXISTS(SELECT 1 FROM public.video_deletions WHERE id=p_id AND owner_id=p_owner) THEN
    RAISE EXCEPTION 'Video not found or access denied' USING ERRCODE='42501'; END IF;
  INSERT INTO public.video_deletions(id,owner_id) VALUES(p_id,p_owner) ON CONFLICT DO NOTHING;
  UPDATE public.video_deletions SET staging_ids=ARRAY(SELECT DISTINCT unnest(staging_ids ||
    ARRAY(SELECT id FROM public.media_upload_jobs WHERE owner_id=p_owner AND (id=p_id OR target_video_id=p_id))))
    WHERE id=p_id AND owner_id=p_owner;
  UPDATE public.media_upload_jobs SET status=CASE WHEN status IN ('processing','cancelling') THEN 'cancelling' ELSE 'cancelled' END
    WHERE owner_id=p_owner AND (id=p_id OR target_video_id=p_id);
  RETURN NOT EXISTS(SELECT 1 FROM public.media_upload_jobs WHERE owner_id=p_owner
    AND (id=p_id OR target_video_id=p_id) AND status='cancelling');
END; $$;
COMMIT;
