-- Permanent deletion remains an explicit confirmed action. A private receipt
-- keeps partially removed trees retryable and blocks replacement during cleanup.
BEGIN;
CREATE TABLE streamly_internal.file_deletions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,object_path text NOT NULL,
 public_id uuid NOT NULL,is_folder boolean NOT NULL,trashed_at timestamptz NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE UNIQUE INDEX file_deletion_pending_path ON streamly_internal.file_deletions(owner_id,object_path) WHERE completed_at IS NULL;
ALTER TABLE streamly_internal.file_deletions OWNER TO postgres;
REVOKE ALL ON streamly_internal.file_deletions FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.begin_user_file_deletion(p_owner uuid,p_path text,p_trashed_at timestamptz,p_folder boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pending streamly_internal.file_deletions; root public.user_file_metadata;
BEGIN
 IF NOT public.active_account(p_owner) OR NOT streamly_internal.valid_file_path(p_path,p_owner) THEN
   RAISE EXCEPTION 'File not found or access denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes) THEN
   RAISE EXCEPTION 'Storage maintenance is in progress' USING ERRCODE='55000'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,176));
 SELECT * INTO pending FROM streamly_internal.file_deletions WHERE owner_id=p_owner AND object_path=p_path AND completed_at IS NULL FOR UPDATE;
 IF FOUND THEN
   IF pending.trashed_at IS DISTINCT FROM p_trashed_at OR pending.is_folder IS DISTINCT FROM p_folder THEN
     RAISE EXCEPTION 'The saved deletion does not match this item' USING ERRCODE='40001'; END IF;
   RETURN pending.id;
 END IF;
 SELECT * INTO root FROM public.user_file_metadata WHERE owner_id=p_owner AND object_path=p_path FOR UPDATE;
 IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM public.user_file_metadata WHERE owner_id=p_owner AND starts_with(object_path,p_path||'/')) THEN
     RAISE EXCEPTION 'The folder has changed. Refresh Trash before deleting it.' USING ERRCODE='40001'; END IF;
   RETURN NULL;
 END IF;
 IF root.trashed_at IS NULL OR root.trashed_at IS DISTINCT FROM p_trashed_at OR root.is_folder IS DISTINCT FROM p_folder
   OR EXISTS(SELECT 1 FROM public.user_file_metadata m WHERE m.owner_id=p_owner AND root.is_folder
     AND starts_with(m.object_path,p_path||'/') AND m.trashed_at IS NULL) THEN
   RAISE EXCEPTION 'This item or part of its contents is no longer in Trash. Refresh Trash before deleting it.' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.file_operation_receipts r WHERE r.owner_id=p_owner AND r.completed_at IS NULL
   AND r.cancelled_at IS NULL AND r.started_at IS NOT NULL AND (
     r.plan->>'source'=p_path OR r.plan->>'destination'=p_path
     OR starts_with(r.plan->>'source',p_path||'/') OR starts_with(r.plan->>'destination',p_path||'/')
     OR starts_with(p_path,(r.plan->>'source')||'/') OR starts_with(p_path,(r.plan->>'destination')||'/'))) THEN
   RAISE EXCEPTION 'Finish or stop the related file transfer before permanent deletion' USING ERRCODE='40001'; END IF;
 INSERT INTO streamly_internal.file_deletions(owner_id,object_path,public_id,is_folder,trashed_at)
 VALUES(p_owner,p_path,root.public_id,root.is_folder,root.trashed_at) RETURNING id INTO pending.id;
 RETURN pending.id;
END;
$$;
ALTER FUNCTION public.begin_user_file_deletion(uuid,text,timestamptz,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.begin_user_file_deletion(uuid,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_user_file_deletion(uuid,text,timestamptz,boolean) TO service_role;

CREATE FUNCTION public.user_file_deletion_objects(p_id uuid,p_owner uuid)
RETURNS TABLE(bucket_id text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH target AS (SELECT * FROM streamly_internal.file_deletions WHERE id=p_id AND owner_id=p_owner AND completed_at IS NULL
   AND public.active_account(p_owner)), candidates AS (
   SELECT actual.bucket_id,actual.name,1 AS priority FROM target d
   JOIN streamly_internal.current_file_objects current ON current.name=d.object_path OR d.is_folder AND starts_with(current.name,d.object_path||'/')
   JOIN storage.objects actual ON actual.id=current.id
   UNION ALL
   SELECT actual.bucket_id,actual.name,0 FROM target d JOIN public.user_file_metadata m ON m.owner_id=d.owner_id
     AND (m.object_path=d.object_path OR d.is_folder AND starts_with(m.object_path,d.object_path||'/'))
   JOIN streamly_internal.storage_migration_objects a ON a.owner_id=m.owner_id AND a.resource_id=m.public_id AND a.resource_type IN ('file','folder')
   JOIN storage.objects actual ON actual.id=a.old_object_id AND actual.bucket_id=a.old_bucket AND actual.name=a.old_key AND actual.version=a.old_version
 ) SELECT c.bucket_id,c.name FROM candidates c GROUP BY c.bucket_id,c.name ORDER BY min(c.priority),c.bucket_id,c.name;
$$;
ALTER FUNCTION public.user_file_deletion_objects(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.user_file_deletion_objects(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.user_file_deletion_objects(uuid,uuid) TO service_role;

CREATE FUNCTION public.finish_user_file_deletion(p_id uuid,p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pending streamly_internal.file_deletions;
BEGIN
 IF NOT public.active_account(p_owner) THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,176));
 SELECT * INTO pending FROM streamly_internal.file_deletions WHERE id=p_id AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Deletion unavailable' USING ERRCODE='42501'; END IF;
 IF pending.completed_at IS NOT NULL THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.user_file_deletion_objects(p_id,p_owner)) THEN
   RAISE EXCEPTION 'Storage cleanup is not complete' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_file_metadata WHERE owner_id=p_owner AND object_path=pending.object_path AND public_id<>pending.public_id) THEN
   RAISE EXCEPTION 'The item changed during deletion' USING ERRCODE='40001'; END IF;
 DELETE FROM public.user_file_metadata WHERE owner_id=p_owner AND (object_path=pending.object_path
   OR pending.is_folder AND starts_with(object_path,pending.object_path||'/'));
 UPDATE streamly_internal.file_deletions SET completed_at=now() WHERE id=p_id;
END;
$$;
ALTER FUNCTION public.finish_user_file_deletion(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finish_user_file_deletion(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_user_file_deletion(uuid,uuid) TO service_role;

CREATE FUNCTION public.guard_pending_file_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_path text; previous_path text;
BEGIN
 IF TG_OP<>'DELETE' AND NEW.bucket_id IN ('user-files','users') THEN
   current_path:=CASE WHEN NEW.bucket_id='user-files' THEN NEW.name WHEN split_part(NEW.name,'/',2)='files'
     THEN split_part(NEW.name,'/',1)||'/'||substring(NEW.name FROM length(split_part(NEW.name,'/',1))+8) END;
 END IF;
 IF TG_OP<>'INSERT' AND OLD.bucket_id IN ('user-files','users') THEN
   previous_path:=CASE WHEN OLD.bucket_id='user-files' THEN OLD.name WHEN split_part(OLD.name,'/',2)='files'
     THEN split_part(OLD.name,'/',1)||'/'||substring(OLD.name FROM length(split_part(OLD.name,'/',1))+8) END;
 END IF;
 IF (TG_OP<>'DELETE' OR current_setting('role',true) IN ('anon','authenticated')) AND EXISTS(
   SELECT 1 FROM streamly_internal.file_deletions d WHERE d.completed_at IS NULL AND (
     current_path=d.object_path OR previous_path=d.object_path
     OR d.is_folder AND (starts_with(current_path,d.object_path||'/') OR starts_with(previous_path,d.object_path||'/')))) THEN
   RAISE EXCEPTION 'Permanent deletion is in progress. Retry the saved deletion to finish.' USING ERRCODE='40001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
ALTER FUNCTION public.guard_pending_file_storage() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_pending_file_storage() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_pending_file_storage BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION public.guard_pending_file_storage();

CREATE FUNCTION public.guard_pending_file_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_path text; previous_path text;
BEGIN
 IF TG_OP<>'DELETE' THEN current_path:=NEW.object_path; END IF;
 IF TG_OP<>'INSERT' THEN previous_path:=OLD.object_path; END IF;
 IF current_setting('role',true) IN ('anon','authenticated') AND pg_trigger_depth()<=1 AND EXISTS(
   SELECT 1 FROM streamly_internal.file_deletions d WHERE d.completed_at IS NULL AND (
     current_path=d.object_path OR previous_path=d.object_path
     OR d.is_folder AND (starts_with(current_path,d.object_path||'/') OR starts_with(previous_path,d.object_path||'/')))) THEN
   RAISE EXCEPTION 'Permanent deletion is in progress. Retry the saved deletion to finish.' USING ERRCODE='40001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
ALTER FUNCTION public.guard_pending_file_metadata() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_pending_file_metadata() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_pending_file_metadata BEFORE INSERT OR UPDATE OR DELETE ON public.user_file_metadata
 FOR EACH ROW EXECUTE FUNCTION public.guard_pending_file_metadata();
NOTIFY pgrst,'reload schema';
COMMIT;
