-- Capture upload locations per job. Do not infer them from a mutable global
-- setting during retries, cleanup or worker processing. Activation stays separate.
BEGIN;
ALTER TABLE public.media_upload_jobs
 ADD COLUMN input_bucket text NOT NULL DEFAULT 'media-staging' CHECK(input_bucket IN ('media-staging','staging')),
 ADD COLUMN input_prefix text,
 ADD COLUMN output_layout smallint NOT NULL DEFAULT 1 CHECK(output_layout IN (1,2));
UPDATE public.media_upload_jobs SET input_prefix=owner_id||'/'||id;
ALTER TABLE public.media_upload_jobs ALTER COLUMN input_prefix SET NOT NULL;
ALTER TABLE public.media_upload_jobs ADD CONSTRAINT media_job_input_identity CHECK(
 input_prefix=CASE WHEN input_bucket='staging' THEN 'uploads/' ELSE '' END||owner_id||'/'||id);
CREATE TRIGGER guard_library_media_job_write BEFORE INSERT OR UPDATE OR DELETE ON public.media_upload_jobs
 FOR EACH ROW EXECUTE FUNCTION public.guard_library_reference_mutation();

CREATE TABLE streamly_internal.media_upload_reservations(
 id uuid PRIMARY KEY,owner_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('video','photo','preview')),
 target_video_id uuid,input_bucket text NOT NULL CHECK(input_bucket IN ('media-staging','staging')),
 input_prefix text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz NOT NULL DEFAULT now()+interval '1 day',
 CHECK(input_prefix=CASE WHEN input_bucket='staging' THEN 'uploads/' ELSE '' END||owner_id||'/'||id),
 CHECK((kind='preview')=(target_video_id IS NOT NULL))
);
ALTER TABLE streamly_internal.media_upload_reservations OWNER TO postgres;
REVOKE ALL ON streamly_internal.media_upload_reservations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.reserve_media_upload(p_id uuid,p_kind text,p_video uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reservation streamly_internal.media_upload_reservations; layout smallint; actor uuid:=auth.uid();
BEGIN
 IF NOT public.active_account(actor) THEN RAISE EXCEPTION 'Please sign in with an active account' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('video','photo','preview')
   OR (p_kind='preview')<>(p_video IS NOT NULL) THEN RAISE EXCEPTION 'Invalid upload reservation' USING ERRCODE='22023'; END IF;
 IF p_kind='preview' AND NOT EXISTS(SELECT 1 FROM public.videos WHERE id=p_video AND owner_id=actor) THEN
   RAISE EXCEPTION 'Video not found or access denied' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.video_deletions WHERE id=p_id OR id=p_video) THEN
   RAISE EXCEPTION 'Video deletion has been requested' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
 SELECT layout_version INTO layout FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes;
 IF layout IS NULL THEN RAISE EXCEPTION 'Storage maintenance is in progress' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.media_upload_jobs WHERE id=p_id) THEN
   RAISE EXCEPTION 'This upload is already queued. Check your gallery before retrying.' USING ERRCODE='40001'; END IF;
 SELECT * INTO reservation FROM streamly_internal.media_upload_reservations WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
   IF reservation.owner_id<>actor OR reservation.kind<>p_kind OR reservation.target_video_id IS DISTINCT FROM p_video THEN
     RAISE EXCEPTION 'Upload reservation does not match' USING ERRCODE='42501'; END IF;
   UPDATE streamly_internal.media_upload_reservations SET lease_until=now()+interval '1 day' WHERE id=p_id;
 ELSE
   IF (SELECT count(*) FROM streamly_internal.media_upload_reservations r WHERE r.owner_id=actor AND r.lease_until>now()
     AND NOT EXISTS(SELECT 1 FROM public.media_upload_jobs j WHERE j.id=r.id))>=30 THEN
     RAISE EXCEPTION 'Too many pending uploads. Wait for processing to finish.'; END IF;
   INSERT INTO streamly_internal.media_upload_reservations(id,owner_id,kind,target_video_id,input_bucket,input_prefix)
   VALUES(p_id,actor,p_kind,p_video,CASE WHEN layout=2 THEN 'staging' ELSE 'media-staging' END,
     CASE WHEN layout=2 THEN 'uploads/' ELSE '' END||actor||'/'||p_id) RETURNING * INTO reservation;
 END IF;
 RETURN jsonb_build_object('bucket',reservation.input_bucket,'prefix',reservation.input_prefix);
END;
$$;
ALTER FUNCTION public.reserve_media_upload(uuid,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_media_upload(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_media_upload(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.queue_media_upload(p_id uuid,p_owner uuid,p_kind text,p_name text,p_visibility text,p_preview boolean DEFAULT false,p_video uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reservation streamly_internal.media_upload_reservations; existing public.media_upload_jobs;
 bucket text:='media-staging';prefix text;layout smallint;
BEGIN
 IF NOT public.active_account(p_owner) THEN RAISE EXCEPTION 'Account is not allowed to upload' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('video','photo','preview') OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 255
   OR p_visibility IS NULL OR p_visibility NOT IN ('public','private') OR p_preview IS NULL
   OR (p_kind='preview')<>(p_video IS NOT NULL) THEN RAISE EXCEPTION 'Invalid upload request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 SELECT * INTO existing FROM public.media_upload_jobs WHERE id=p_id;
 IF FOUND THEN
   IF existing.owner_id<>p_owner OR existing.kind<>p_kind OR existing.file_name<>btrim(p_name)
     OR existing.visibility<>p_visibility OR existing.has_preview<>p_preview OR existing.target_video_id IS DISTINCT FROM p_video THEN
     RAISE EXCEPTION 'This upload is already queued with different details' USING ERRCODE='40001'; END IF;
   RETURN p_id;
 END IF;
 SELECT layout_version INTO layout FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes;
 IF layout IS NULL THEN RAISE EXCEPTION 'Storage maintenance is in progress' USING ERRCODE='55000'; END IF;
 IF (SELECT count(*) FROM public.media_upload_jobs WHERE owner_id=p_owner AND status IN ('queued','processing'))>=30 THEN
   RAISE EXCEPTION 'Too many pending uploads. Wait for processing to finish.'; END IF;
 IF p_kind='preview' THEN
   SELECT CASE WHEN preview_bucket='users' THEN 2 ELSE 1 END INTO layout FROM public.videos WHERE id=p_video AND owner_id=p_owner;
   IF NOT FOUND THEN RAISE EXCEPTION 'Video not found or access denied' USING ERRCODE='42501'; END IF;
 END IF;
 prefix:=p_owner||'/'||p_id;
 SELECT * INTO reservation FROM streamly_internal.media_upload_reservations WHERE id=p_id;
 IF FOUND THEN
   IF reservation.owner_id<>p_owner OR reservation.kind<>p_kind OR reservation.target_video_id IS DISTINCT FROM p_video THEN
     RAISE EXCEPTION 'Upload reservation does not match' USING ERRCODE='42501'; END IF;
   IF reservation.lease_until<=now() THEN RAISE EXCEPTION 'Upload reservation expired. Retry the upload.' USING ERRCODE='40001'; END IF;
   bucket:=reservation.input_bucket;prefix:=reservation.input_prefix;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=bucket AND name=prefix||'/source'
   AND (metadata->>'size')::bigint>0 AND version IS NOT NULL)
   OR p_preview AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=bucket AND name=prefix||'/preview'
     AND (metadata->>'size')::bigint>0 AND version IS NOT NULL) THEN
   RAISE EXCEPTION 'Upload is incomplete'; END IF;
 INSERT INTO public.media_upload_jobs(id,owner_id,kind,target_video_id,file_name,visibility,has_preview,input_bucket,input_prefix,output_layout)
 VALUES(p_id,p_owner,p_kind,p_video,btrim(p_name),p_visibility,p_preview,bucket,prefix,layout);
 RETURN p_id;
END;
$$;
ALTER FUNCTION public.queue_media_upload(uuid,uuid,text,text,text,boolean,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.queue_media_upload(uuid,uuid,text,text,text,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_media_upload(uuid,uuid,text,text,text,boolean,uuid) TO service_role;

CREATE FUNCTION public.can_write_staged_upload(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.active_account(auth.uid()) AND EXISTS(SELECT 1 FROM streamly_internal.media_upload_reservations r
   WHERE r.owner_id=auth.uid() AND r.input_bucket='staging' AND r.lease_until>now()
     AND p_name IN (r.input_prefix||'/source',r.input_prefix||'/preview')
     AND NOT EXISTS(SELECT 1 FROM public.video_deletions d WHERE d.id=r.id OR d.id=r.target_video_id)
     AND NOT EXISTS(SELECT 1 FROM public.media_upload_jobs j WHERE j.id=r.id))
   AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes);
$$;
ALTER FUNCTION public.can_write_staged_upload(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_write_staged_upload(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_write_staged_upload(text) TO authenticated;
CREATE POLICY reserved_staging_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='staging' AND public.can_write_staged_upload(name));

CREATE FUNCTION public.can_read_staged_upload(p_name text,p_delete boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.active_account(auth.uid()) AND EXISTS(SELECT 1 FROM streamly_internal.media_upload_reservations r
   WHERE r.owner_id=auth.uid() AND r.input_bucket='staging' AND p_name IN (r.input_prefix||'/source',r.input_prefix||'/preview')
     AND (NOT p_delete OR NOT EXISTS(SELECT 1 FROM public.media_upload_jobs j WHERE j.id=r.id AND j.status IN ('queued','processing','cancelling'))));
$$;
ALTER FUNCTION public.can_read_staged_upload(text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_read_staged_upload(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_staged_upload(text,boolean) TO authenticated;
CREATE POLICY reserved_staging_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='staging' AND public.can_read_staged_upload(name));
CREATE POLICY reserved_staging_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='staging' AND public.can_read_staged_upload(name,true));

CREATE FUNCTION public.can_change_legacy_staging(p_name text,p_delete boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.active_account(auth.uid()) AND NOT EXISTS(SELECT 1 FROM public.video_deletions d WHERE d.owner_id=auth.uid()
   AND (p_name IN (d.owner_id||'/'||d.id||'/source',d.owner_id||'/'||d.id||'/preview')
     OR coalesce(to_jsonb(d)->'staging_ids','[]'::jsonb) ? split_part(p_name,'/',2)))
 AND NOT EXISTS(SELECT 1 FROM public.media_upload_jobs j WHERE j.owner_id=auth.uid()
   AND p_name IN (j.owner_id||'/'||j.id||'/source',j.owner_id||'/'||j.id||'/preview')
   AND (NOT p_delete OR j.status IN ('queued','processing','cancelling')));
$$;
ALTER FUNCTION public.can_change_legacy_staging(text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_change_legacy_staging(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_change_legacy_staging(text,boolean) TO authenticated;
CREATE POLICY legacy_staging_queued_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'media-staging' OR public.can_change_legacy_staging(name));
CREATE POLICY legacy_staging_processing_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'media-staging' OR public.can_change_legacy_staging(name,true));
-- Reservation expiry gates new writes only. It is NEVER a reason to glob or
-- delete TUS/JSON state: provider locks, completion and recovery remain separate.
NOTIFY pgrst,'reload schema';
COMMIT;
