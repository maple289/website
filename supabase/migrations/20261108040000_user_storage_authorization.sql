-- Resource-specific authorization. Never make a library bucket public.
BEGIN;
CREATE FUNCTION public.can_read_user_library_object(p_id uuid,p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=2)
 AND (
   EXISTS(SELECT 1 FROM streamly_internal.library_media_objects m WHERE m.bucket_id='users' AND m.object_path=p_name
     AND (m.visibility='public' AND m.ready OR current_setting('role',true)='authenticated' AND m.owner_id=auth.uid() AND public.active_account(auth.uid())))
   OR (current_setting('role',true)='authenticated' AND public.active_account(auth.uid()) AND (
     EXISTS(SELECT 1 FROM public.user_file_metadata m WHERE m.storage_bucket='users' AND NOT m.is_folder AND m.source_id=p_id
       AND p_name=m.owner_id||'/files/'||substring(m.object_path FROM length(m.owner_id::text)+2)
       AND public.can_read_user_file(m.object_path))
     OR EXISTS(SELECT 1 FROM public.user_file_metadata m WHERE m.storage_bucket='users' AND m.is_folder AND m.owner_id=auth.uid()
       AND p_name IN (m.owner_id||'/files/'||substring(m.object_path FROM length(m.owner_id::text)+2)||'/.folder',
         m.owner_id||'/files/'||substring(m.object_path FROM length(m.owner_id::text)+2)||'/.keep'))
     OR EXISTS(SELECT 1 FROM public.media_upload_jobs j JOIN public.videos v ON v.id=j.target_video_id AND v.owner_id=j.owner_id
       WHERE j.kind='preview' AND j.status='complete' AND j.owner_id=auth.uid() AND v.preview_bucket='users' AND j.result->>'path'=p_name)
     OR EXISTS(SELECT 1 FROM public.media_upload_jobs j JOIN public.videos v ON v.id=j.id AND v.owner_id=j.owner_id
       WHERE j.kind='video' AND j.status='complete' AND j.owner_id=auth.uid() AND v.preview_bucket='users'
         AND to_jsonb(j)->>'output_layout'='2' AND p_name=j.owner_id||'/videos/'||j.id||'/thumbnail.webp')
     OR EXISTS(SELECT 1 FROM streamly_internal.storage_migration_objects a JOIN public.videos v ON v.id=a.resource_id AND v.owner_id=a.owner_id
       WHERE a.resource_type='video' AND a.media_role='preview' AND a.owner_id=auth.uid()
         AND a.new_object_id=p_id AND a.new_key=p_name)))
 );
$$;
ALTER FUNCTION public.can_read_user_library_object(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_read_user_library_object(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_user_library_object(uuid,text) TO anon,authenticated;
-- Storage move/copy checks SELECT against the proposed row before AFTER catalog
-- triggers bind its new path/ID. Permit the verified catalog owner within their
-- files namespace during that transition. The API sets owner_id from the JWT;
-- a path alone and a service-owned unbound preparatory copy grant nothing.
CREATE FUNCTION public.can_read_owned_library_file(p_name text,p_storage_owner text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT current_setting('role',true)='authenticated' AND public.active_account(auth.uid())
 AND p_storage_owner=auth.uid()::text AND starts_with(p_name,auth.uid()::text||'/files/')
 AND streamly_internal.valid_file_path(p_name,auth.uid())
 AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=2);
$$;
ALTER FUNCTION public.can_read_owned_library_file(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_read_owned_library_file(text,text) FROM PUBLIC;
-- Both policy roles need EXECUTE during expression initialization. The helper
-- itself returns false for anon; granting execution grants no object access.
GRANT EXECUTE ON FUNCTION public.can_read_owned_library_file(text,text) TO anon,authenticated;
CREATE POLICY users_resource_read ON storage.objects FOR SELECT TO anon,authenticated
 USING(bucket_id='users' AND (public.can_read_user_library_object(id,name)
   OR current_setting('role',true)='authenticated' AND public.can_read_owned_library_file(name,to_jsonb(objects)->>'owner_id')));

CREATE FUNCTION public.can_write_user_library_file(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.active_account(auth.uid()) AND starts_with(p_name,auth.uid()::text||'/files/')
   AND streamly_internal.valid_file_path(p_name,auth.uid())
   AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=2 AND NOT pause_library_writes);
$$;
ALTER FUNCTION public.can_write_user_library_file(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_write_user_library_file(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_write_user_library_file(text) TO authenticated;
CREATE POLICY users_file_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='users' AND public.can_write_user_library_file(name));
CREATE POLICY users_file_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='users' AND public.can_write_user_library_file(name))
 WITH CHECK(bucket_id='users' AND public.can_write_user_library_file(name));
CREATE POLICY users_file_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='users' AND public.can_write_user_library_file(name));
CREATE FUNCTION public.can_delete_unused_library_preview(p_id uuid,p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.active_account(auth.uid()) AND (
   EXISTS(SELECT 1 FROM public.media_upload_jobs j JOIN public.videos v ON v.id=j.target_video_id AND v.owner_id=j.owner_id
     WHERE j.kind='preview' AND j.status='complete' AND j.owner_id=auth.uid() AND v.preview_bucket='users'
       AND j.result->>'path'=p_name AND v.preview_path IS DISTINCT FROM p_name)
   OR EXISTS(SELECT 1 FROM public.media_upload_jobs j JOIN public.videos v ON v.id=j.id AND v.owner_id=j.owner_id
     WHERE j.kind='video' AND j.status='complete' AND j.owner_id=auth.uid() AND v.preview_bucket='users'
       AND to_jsonb(j)->>'output_layout'='2' AND p_name=j.owner_id||'/videos/'||j.id||'/thumbnail.webp' AND v.preview_path IS DISTINCT FROM p_name)
   OR EXISTS(SELECT 1 FROM streamly_internal.storage_migration_objects a JOIN public.videos v ON v.id=a.resource_id AND v.owner_id=a.owner_id
     WHERE a.resource_type='video' AND a.media_role='preview' AND a.owner_id=auth.uid()
       AND a.new_object_id=p_id AND a.new_key=p_name AND v.preview_path IS DISTINCT FROM p_name));
$$;
ALTER FUNCTION public.can_delete_unused_library_preview(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_delete_unused_library_preview(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_delete_unused_library_preview(uuid,text) TO authenticated;
CREATE POLICY users_unused_video_preview_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='users' AND public.can_delete_unused_library_preview(id,name));

-- Older clients must refresh before writing legacy permanent file keys after
-- activation. Existing reads and service/operator rollback access are preserved.
CREATE FUNCTION public.legacy_file_writes_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=1 AND NOT pause_library_writes);
$$;
ALTER FUNCTION public.legacy_file_writes_allowed() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.legacy_file_writes_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.legacy_file_writes_allowed() TO authenticated;
CREATE POLICY library_legacy_file_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'user-files' OR public.legacy_file_writes_allowed());
CREATE POLICY library_legacy_file_update_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(true)
 WITH CHECK(bucket_id<>'user-files' OR public.legacy_file_writes_allowed());

-- A service-role endpoint/worker must obey the cutover write gate too. The
-- dedicated worker is drained before this flag is set. Direct DB operators may
-- update references while API/Storage connections remain blocked.
CREATE FUNCTION public.guard_library_storage_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE bucket text; object_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN bucket:=OLD.bucket_id;object_id:=OLD.id; ELSE bucket:=NEW.bucket_id;object_id:=NEW.id; END IF;
 IF bucket NOT IN ('user-files','user-images','user-videos','users','media-staging','staging','cache') THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF (session_user NOT IN ('postgres','supabase_admin') OR current_setting('role',true) IN ('anon','authenticated','service_role'))
   AND NOT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes) THEN
   RAISE EXCEPTION 'Storage maintenance is in progress. Please retry shortly.' USING ERRCODE='55000'; END IF;
 IF TG_OP<>'DELETE' AND public.is_retired_library_object(object_id) THEN
   RAISE EXCEPTION 'Retired storage cannot become active' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
ALTER FUNCTION public.guard_library_storage_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_library_storage_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_library_storage_mutation BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION public.guard_library_storage_mutation();

CREATE FUNCTION public.guard_library_reference_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (session_user NOT IN ('postgres','supabase_admin') OR current_setting('role',true) IN ('anon','authenticated','service_role'))
   AND NOT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes) THEN
   RAISE EXCEPTION 'Storage maintenance is in progress. Please retry shortly.' USING ERRCODE='55000'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
ALTER FUNCTION public.guard_library_reference_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_library_reference_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_library_video_write BEFORE INSERT OR UPDATE OR DELETE ON public.videos
 FOR EACH ROW EXECUTE FUNCTION public.guard_library_reference_mutation();
CREATE TRIGGER guard_library_photo_write BEFORE INSERT OR UPDATE OR DELETE ON public.photos
 FOR EACH ROW EXECUTE FUNCTION public.guard_library_reference_mutation();
CREATE TRIGGER guard_library_file_metadata_write BEFORE INSERT OR UPDATE OR DELETE ON public.user_file_metadata
 FOR EACH ROW EXECUTE FUNCTION public.guard_library_reference_mutation();
NOTIFY pgrst,'reload schema';
COMMIT;
