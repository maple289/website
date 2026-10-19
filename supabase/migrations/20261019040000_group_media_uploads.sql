BEGIN;
-- Retain the requested destination even if a group is deleted while processing.
-- A missing destination must fail publication, not silently become a personal
-- upload. This UUID is job intent, not a grant or a cascading content reference.
ALTER TABLE public.media_upload_jobs ADD COLUMN upload_group_id uuid;
ALTER TABLE public.media_upload_jobs ADD CONSTRAINT group_upload_private
 CHECK(upload_group_id IS NULL OR (kind IN ('video','photo') AND visibility='private'));
CREATE INDEX media_jobs_group ON public.media_upload_jobs(owner_id,upload_group_id,created_at DESC) WHERE upload_group_id IS NOT NULL;

CREATE FUNCTION public.queue_group_media_upload(p_id uuid,p_owner uuid,p_kind text,p_name text,p_group uuid,p_preview boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.media_upload_jobs; queued_id uuid;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('video','photo') OR NOT public.active_account(p_owner) THEN
   RAISE EXCEPTION 'Group upload unavailable' USING ERRCODE='42501';
 END IF;
 -- Keep the base queue's owner lock and the publisher's job-before-group order.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 SELECT * INTO existing FROM public.media_upload_jobs WHERE id=p_id FOR UPDATE;
 PERFORM 1 FROM public.messenger_conversations WHERE id=p_group AND kind='group' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.messenger_members WHERE conversation_id=p_group AND user_id=p_owner) THEN
   RAISE EXCEPTION 'Group unavailable. You must be a current member to upload.' USING ERRCODE='42501';
 END IF;
 IF existing.id IS NOT NULL THEN
   IF existing.owner_id IS DISTINCT FROM p_owner OR existing.upload_group_id IS DISTINCT FROM p_group
     OR existing.kind IS DISTINCT FROM p_kind OR existing.file_name IS DISTINCT FROM btrim(p_name)
     OR existing.has_preview IS DISTINCT FROM p_preview THEN RAISE EXCEPTION 'Upload destination does not match its job'; END IF;
   RETURN existing.id;
 END IF;
 queued_id:=public.queue_media_upload(p_id,p_owner,p_kind,p_name,'private',p_preview,NULL);
 UPDATE public.media_upload_jobs SET upload_group_id=p_group WHERE id=queued_id;
 RETURN queued_id;
END $$;
REVOKE ALL ON FUNCTION public.queue_group_media_upload(uuid,uuid,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_group_media_upload(uuid,uuid,text,text,uuid,boolean) TO service_role;

-- The existing publisher inserts validated media and then completes the job in
-- one transaction. Insert its grant here so either both publish or both roll back.
CREATE FUNCTION public.share_completed_group_upload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='complete' AND OLD.status IS DISTINCT FROM 'complete' AND NEW.upload_group_id IS NOT NULL THEN
   PERFORM 1 FROM public.messenger_conversations WHERE id=NEW.upload_group_id AND kind='group' FOR UPDATE;
   IF NOT FOUND OR NOT public.active_account(NEW.owner_id) OR NOT EXISTS(
     SELECT 1 FROM public.messenger_members WHERE conversation_id=NEW.upload_group_id AND user_id=NEW.owner_id
   ) THEN RAISE EXCEPTION 'Group unavailable. Upload publication requires current membership.' USING ERRCODE='42501'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.videos WHERE NEW.kind='video' AND id=NEW.id AND owner_id=NEW.owner_id AND visibility='private'
     UNION ALL SELECT 1 FROM public.photos WHERE NEW.kind='photo' AND id=NEW.id AND owner_id=NEW.owner_id AND visibility='private') THEN
     RAISE EXCEPTION 'Group upload has no matching validated media';
   END IF;
   INSERT INTO public.media_shares(media_type,media_id,group_id,created_by)
     VALUES(NEW.kind,NEW.id,NEW.upload_group_id,NEW.owner_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.share_completed_group_upload() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER share_completed_group_upload BEFORE UPDATE OF status ON public.media_upload_jobs
 FOR EACH ROW EXECUTE FUNCTION public.share_completed_group_upload();
NOTIFY pgrst,'reload schema';
COMMIT;
