-- Operator-only retirement of verified migration duplicates. This is not an
-- application deletion endpoint or an age/extension-based storage sweeper.
BEGIN;
CREATE TABLE streamly_internal.retired_storage_cleanup (
 old_object_id uuid PRIMARY KEY,
 run_id uuid NOT NULL,
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 new_object_id uuid,
 new_version text,
 new_updated_at timestamptz,
 new_bytes bigint CHECK(new_bytes>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 completed_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),
 CHECK((new_object_id IS NULL AND new_version IS NULL AND new_updated_at IS NULL AND new_bytes IS NULL)
   OR (new_object_id IS NOT NULL AND new_version IS NOT NULL AND new_updated_at IS NOT NULL AND new_bytes IS NOT NULL))
);
ALTER TABLE streamly_internal.retired_storage_cleanup OWNER TO postgres;
REVOKE ALL ON streamly_internal.retired_storage_cleanup FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION streamly_internal.approved_retired_storage_delete(p_old storage.objects) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT current_setting('role',true)='service_role'
 AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control
   WHERE id AND layout_version=2 AND pause_media_claims AND pause_library_writes)
 AND EXISTS(
  SELECT 1 FROM streamly_internal.retired_storage_cleanup intent
  JOIN streamly_internal.storage_migration_objects a USING(old_object_id)
  WHERE intent.old_object_id=(p_old).id AND intent.completed_at IS NULL AND intent.expires_at>now()
   AND a.retired_at IS NOT NULL AND a.sha256=intent.sha256
   AND a.old_bucket=(p_old).bucket_id AND a.old_key=(p_old).name AND a.old_version=(p_old).version
   AND a.old_created_at=(p_old).created_at AND a.old_updated_at=(p_old).updated_at
   AND a.bytes=((p_old).metadata->>'size')::bigint
   AND a.new_object_id IS NOT DISTINCT FROM intent.new_object_id
   AND (
    a.resource_type<>'folder' AND EXISTS(
     SELECT 1 FROM storage.objects current_object
     JOIN streamly_internal.library_gateway_sources resource ON resource.bucket_id=current_object.bucket_id
       AND resource.object_path=current_object.name AND resource.resource_type=a.resource_type
       AND resource.resource_id=a.resource_id AND resource.owner_id=a.owner_id
       AND resource.media_role=a.media_role AND resource.ready
     WHERE current_object.id=a.new_object_id AND current_object.bucket_id=a.new_bucket
       AND current_object.name=a.new_key AND current_object.version=a.new_version
       AND current_object.version=intent.new_version AND current_object.updated_at=intent.new_updated_at
       AND (current_object.metadata->>'size')::bigint=a.bytes AND a.bytes=intent.new_bytes
    )
    OR a.resource_type='folder' AND a.bytes=0 AND intent.new_object_id IS NULL AND EXISTS(
     SELECT 1 FROM public.user_file_metadata folder WHERE folder.public_id=a.resource_id
       AND folder.owner_id=a.owner_id AND folder.is_folder AND folder.storage_bucket='users'
       AND folder.source_id IS NULL AND folder.trashed_at IS NULL
       AND (p_old).name IN (folder.object_path||'/.folder',folder.object_path||'/.keep')
    )
   )
 );
$$;
ALTER FUNCTION streamly_internal.approved_retired_storage_delete(storage.objects) OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.approved_retired_storage_delete(storage.objects) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_library_storage_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE bucket text; object_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN bucket:=OLD.bucket_id;object_id:=OLD.id; ELSE bucket:=NEW.bucket_id;object_id:=NEW.id; END IF;
 IF bucket NOT IN ('user-files','user-images','user-videos','users','media-staging','staging','cache') THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF (session_user NOT IN ('postgres','supabase_admin') OR current_setting('role',true) IN ('anon','authenticated','service_role'))
   AND NOT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes) THEN
   -- Only a DB operator can prepare these short-lived exact-identity intents.
   -- Allow Storage to remove retired duplicates while ordinary writes stay frozen.
   IF TG_OP='DELETE' AND streamly_internal.approved_retired_storage_delete(OLD) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'Storage maintenance is in progress. Please retry shortly.' USING ERRCODE='55000';
 END IF;
 IF TG_OP<>'DELETE' AND public.is_retired_library_object(object_id) THEN
   RAISE EXCEPTION 'Retired storage cannot become active' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
ALTER FUNCTION public.guard_library_storage_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_library_storage_mutation() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
