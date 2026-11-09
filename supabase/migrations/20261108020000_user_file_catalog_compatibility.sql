-- Keep virtual file paths/public IDs stable while physical locations change.
-- Layout stays 1 until the verified, operator-controlled reference transaction.
BEGIN;
CREATE VIEW streamly_internal.current_file_objects AS
 SELECT o.* FROM storage.objects o WHERE o.bucket_id='user-files'
   AND NOT public.is_retired_library_object(o.id)
   AND NOT EXISTS(SELECT 1 FROM public.user_file_metadata m WHERE m.storage_bucket='users'
     AND (m.object_path=o.name OR m.is_folder AND o.name IN (m.object_path||'/.folder',m.object_path||'/.keep')))
 UNION ALL
 SELECT (jsonb_populate_record(NULL::storage.objects,to_jsonb(o)||jsonb_build_object(
   'bucket_id','user-files','name',m.object_path,'path_tokens',string_to_array(m.object_path,'/')))).*
 FROM storage.objects o JOIN public.user_file_metadata m ON m.source_id=o.id AND NOT m.is_folder
 WHERE o.bucket_id='users' AND m.storage_bucket='users'
   AND o.name=m.owner_id||'/files/'||substring(m.object_path FROM length(m.owner_id::text)+2)
 UNION ALL
 SELECT (jsonb_populate_record(NULL::storage.objects,to_jsonb(o)||jsonb_build_object(
   'bucket_id','user-files','name',m.object_path||'/'||regexp_replace(o.name,'^.*/',''),
   'path_tokens',string_to_array(m.object_path||'/'||regexp_replace(o.name,'^.*/',''),'/')))).*
 FROM storage.objects o JOIN public.user_file_metadata m ON m.is_folder AND m.storage_bucket='users'
 WHERE o.bucket_id='users' AND o.name IN (
   m.owner_id||'/files/'||substring(m.object_path FROM length(m.owner_id::text)+2)||'/.folder',
   m.owner_id||'/files/'||substring(m.object_path FROM length(m.owner_id::text)+2)||'/.keep');
ALTER VIEW streamly_internal.current_file_objects OWNER TO postgres;
REVOKE ALL ON streamly_internal.current_file_objects FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION streamly_internal.valid_file_path(p_path text,p_owner uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_path IS NOT NULL AND starts_with(p_path,p_owner::text||'/')
   AND length(p_path)<2048 AND p_path !~ '(^|/)(\.|\.\.)(/|$)'
   AND position('//' IN p_path)=0 AND position(chr(92) IN p_path)=0
   AND p_path !~ '[[:cntrl:]]' AND right(p_path,1)<>'/';
$$;
ALTER FUNCTION streamly_internal.valid_file_path(text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.valid_file_path(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.touch_user_file_metadata_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND session_user IN ('postgres','supabase_admin')
   AND current_setting('role',true) NOT IN ('anon','authenticated','service_role')
   AND (to_jsonb(NEW)-ARRAY['source_id','storage_bucket','updated_at']) IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['source_id','storage_bucket','updated_at']) THEN
   -- A verified operator reference cutover is not a user edit. Browser/API
   -- writes still get the server clock, including no-op/upsert requests.
   NEW.updated_at:=OLD.updated_at;
 ELSE NEW.updated_at:=now(); END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_user_file_metadata_updated_at() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_file_metadata_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source storage.objects; existing public.user_file_metadata; layout smallint; physical text;
  browser boolean:=current_setting('role',true) IN ('anon','authenticated');
BEGIN
 IF NOT streamly_internal.valid_file_path(NEW.object_path,NEW.owner_id) THEN
   RAISE EXCEPTION 'Invalid file path' USING ERRCODE='22023'; END IF;
 SELECT layout_version INTO layout FROM streamly_internal.library_storage_control WHERE id;
 IF browser AND pg_trigger_depth()<=1 THEN
   -- BEFORE INSERT fires before ON CONFLICT. Favorite/transfer upserts must retain
   -- the managed binding and public ID already saved for this virtual path.
   IF TG_OP='INSERT' THEN
     SELECT * INTO existing FROM public.user_file_metadata WHERE owner_id=NEW.owner_id AND object_path=NEW.object_path;
     IF FOUND THEN
       NEW.storage_bucket:=existing.storage_bucket;NEW.source_id:=existing.source_id;NEW.public_id:=existing.public_id;
     ELSE NEW.storage_bucket:=CASE WHEN layout=2 THEN 'users' ELSE 'user-files' END;NEW.public_id:=gen_random_uuid(); END IF;
   ELSIF NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.public_id IS DISTINCT FROM OLD.public_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
     RAISE EXCEPTION 'File storage identity is server-managed' USING ERRCODE='42501';
   END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.user_file_metadata parent WHERE parent.owner_id=NEW.owner_id
   AND NOT parent.is_folder AND starts_with(NEW.object_path,parent.object_path||'/')) THEN
   RAISE EXCEPTION 'A file cannot contain another item' USING ERRCODE='23514'; END IF;
 IF NEW.is_folder THEN
   IF EXISTS(SELECT 1 FROM streamly_internal.current_file_objects o WHERE o.name=NEW.object_path) THEN
     RAISE EXCEPTION 'A file already uses this folder name' USING ERRCODE='23505'; END IF;
   IF NEW.storage_bucket='user-files' AND NOT EXISTS(SELECT 1 FROM storage.objects
     WHERE bucket_id='user-files' AND starts_with(name,NEW.object_path||'/')) THEN
     RAISE EXCEPTION 'Folder does not exist in storage' USING ERRCODE='23503'; END IF;
   IF NEW.storage_bucket='users' AND layout<>2 THEN
     -- The operator performs the reference transaction and flips layout in the
     -- same transaction. API clients cannot pre-activate folders independently.
     IF current_setting('role',true) IN ('anon','authenticated','service_role') THEN
       RAISE EXCEPTION 'The new storage layout is not active' USING ERRCODE='42501'; END IF;
   END IF;
   NEW.source_id:=NULL;NEW.file_size:=0;NEW.mime_type:='';
 ELSE
   physical:=CASE WHEN NEW.storage_bucket='users' THEN NEW.owner_id||'/files/'||substring(NEW.object_path FROM length(NEW.owner_id::text)+2) ELSE NEW.object_path END;
   SELECT * INTO source FROM storage.objects WHERE bucket_id=NEW.storage_bucket AND name=physical;
   IF NOT FOUND OR public.is_retired_library_object(source.id) THEN
     RAISE EXCEPTION 'File does not exist in active storage' USING ERRCODE='23503'; END IF;
   NEW.source_id:=source.id;NEW.file_size:=coalesce((source.metadata->>'size')::bigint,0);
   NEW.mime_type:=coalesce(source.metadata->>'mimetype','');
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_file_catalog_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE object_row storage.objects; account uuid; item_path text; old_path text; marker boolean;
BEGIN
 IF TG_OP='DELETE' THEN object_row:=OLD; ELSE object_row:=NEW; END IF;
 IF object_row.bucket_id='users' THEN
   IF split_part(object_row.name,'/',2)<>'files' OR NOT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=2) THEN RETURN NULL; END IF;
   item_path:=split_part(object_row.name,'/',1)||'/'||substring(object_row.name FROM length(split_part(object_row.name,'/',1))+8);
 ELSIF object_row.bucket_id='user-files' THEN item_path:=object_row.name;
 ELSE RETURN NULL; END IF;
 SELECT id INTO account FROM public.profiles WHERE id::text=split_part(item_path,'/',1);
 IF account IS NULL THEN
   IF TG_OP='DELETE' THEN RETURN NULL; END IF;
   RAISE EXCEPTION 'File owner no longer exists' USING ERRCODE='23503'; END IF;
 marker:=right(item_path,8)='/.folder' OR right(item_path,6)='/.keep';
 IF marker THEN item_path:=regexp_replace(item_path,'/(\.folder|\.keep)$',''); END IF;
 IF TG_OP='DELETE' THEN
   IF NOT marker THEN
     DELETE FROM public.user_file_metadata WHERE owner_id=account AND storage_bucket=object_row.bucket_id
       AND (source_id=object_row.id OR source_id IS NULL AND object_row.bucket_id='user-files' AND object_path=item_path);
   ELSIF NOT EXISTS(SELECT 1 FROM streamly_internal.current_file_objects o WHERE starts_with(o.name,item_path||'/')) THEN
     DELETE FROM public.user_file_metadata WHERE owner_id=account AND object_path=item_path AND is_folder AND storage_bucket=object_row.bucket_id;
   END IF;
   RETURN NULL;
 END IF;
 IF public.is_retired_library_object(object_row.id) THEN RAISE EXCEPTION 'Retired storage cannot become active'; END IF;
 IF TG_OP='UPDATE' AND (OLD.name IS DISTINCT FROM NEW.name OR OLD.bucket_id IS DISTINCT FROM NEW.bucket_id) THEN
   IF marker THEN RETURN NULL; END IF;
   old_path:=CASE WHEN OLD.bucket_id='users' THEN split_part(OLD.name,'/',1)||'/'||substring(OLD.name FROM length(split_part(OLD.name,'/',1))+8) ELSE OLD.name END;
   UPDATE public.user_file_metadata SET object_path=item_path,storage_bucket=NEW.bucket_id,
     source_id=NEW.id,file_size=coalesce((NEW.metadata->>'size')::bigint,0),mime_type=coalesce(NEW.metadata->>'mimetype','')
     WHERE owner_id=account AND object_path=old_path AND NOT is_folder;
   IF FOUND THEN RETURN NULL; END IF;
 END IF;
 INSERT INTO public.user_file_metadata(owner_id,object_path,is_folder,source_id,file_size,mime_type,storage_bucket)
 VALUES(account,item_path,marker,CASE WHEN marker THEN NULL ELSE object_row.id END,
   CASE WHEN marker THEN 0 ELSE coalesce((object_row.metadata->>'size')::bigint,0) END,
   CASE WHEN marker THEN '' ELSE coalesce(object_row.metadata->>'mimetype','') END,object_row.bucket_id)
 ON CONFLICT(owner_id,object_path) DO UPDATE SET source_id=EXCLUDED.source_id,storage_bucket=EXCLUDED.storage_bucket,
   file_size=EXCLUDED.file_size,mime_type=EXCLUDED.mime_type;
 RETURN NULL;
END;
$$;

-- Preserve all established source-version, conflict, Trash and durable-receipt
-- checks. Change only their catalog source, with an exact known-function list.
DO $$
DECLARE signature text; definition text; revised text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.internal_plan_file_operation(text,text,boolean,boolean)',
   'public.begin_file_operation(uuid,text,text,boolean,boolean)',
   'public.file_operation_step(uuid,text,boolean,boolean)','public.finish_file_operation(uuid)'] LOOP
   definition:=pg_get_functiondef(signature::regprocedure);
   IF position('storage.objects' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected file-operation definition: %',signature; END IF;
   revised:=replace(definition,'storage.objects','streamly_internal.current_file_objects');
   IF signature LIKE 'public.internal_plan_file_operation%' THEN
     IF position('IF objects IS NULL THEN' IN revised)=0 THEN RAISE EXCEPTION 'Unexpected folder plan contract'; END IF;
     revised:=replace(revised,'IF objects IS NULL THEN','IF objects IS NULL AND NOT item.is_folder THEN');
     revised:=replace(revised,'IF p_restore AND p_source=p_destination THEN', 'objects:=coalesce(objects,''[]''::jsonb); IF p_restore AND p_source=p_destination THEN');
   END IF;
   EXECUTE revised;
 END LOOP;
END $$;

CREATE FUNCTION public.file_manager_objects(p_folder text,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0)
RETURNS TABLE(name text,id uuid,metadata jsonb,created_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.active_account(auth.uid()) OR (p_folder<>auth.uid()::text AND NOT streamly_internal.valid_file_path(p_folder,auth.uid())) THEN
   RAISE EXCEPTION 'Only your own folders can be listed' USING ERRCODE='42501'; END IF;
 RETURN QUERY WITH children AS (
   SELECT split_part(substring(o.name FROM length(p_folder)+2),'/',1) AS child,
     CASE WHEN position('/' IN substring(o.name FROM length(p_folder)+2))=0 THEN o.id END AS object_id,
     o.metadata AS object_metadata,o.created_at AS created,o.updated_at AS updated
   FROM streamly_internal.current_file_objects o WHERE starts_with(o.name,p_folder||'/')
   UNION ALL SELECT substring(m.object_path FROM length(p_folder)+2),NULL,NULL,m.created_at,m.updated_at
   FROM public.user_file_metadata m WHERE m.owner_id=auth.uid() AND m.is_folder
     AND starts_with(m.object_path,p_folder||'/') AND position('/' IN substring(m.object_path FROM length(p_folder)+2))=0
 ), distinct_children AS (
   SELECT DISTINCT ON(child) child,object_id,object_metadata,created,updated FROM children
   WHERE child<>'' ORDER BY child,object_id NULLS LAST,updated DESC
 ) SELECT child,object_id,object_metadata,created,updated FROM distinct_children
 ORDER BY child LIMIT greatest(1,least(coalesce(p_limit,100),1000)) OFFSET greatest(0,least(coalesce(p_offset,0),1000000));
END;
$$;
ALTER FUNCTION public.file_manager_objects(text,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.file_manager_objects(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.file_manager_objects(text,integer,integer) TO authenticated;

CREATE FUNCTION public.resolve_user_file_location(p_path text,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE bucket text; physical text; object_id uuid; layout smallint;
BEGIN
 IF NOT public.active_account(auth.uid()) THEN RAISE EXCEPTION 'Please sign in' USING ERRCODE='42501'; END IF;
 IF p_write THEN
   IF NOT streamly_internal.valid_file_path(p_path,auth.uid()) THEN RAISE EXCEPTION 'Invalid destination' USING ERRCODE='42501'; END IF;
   SELECT layout_version INTO layout FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes;
   IF layout IS NULL THEN RAISE EXCEPTION 'Storage maintenance is in progress' USING ERRCODE='55000'; END IF;
   SELECT storage_bucket INTO bucket FROM public.user_file_metadata WHERE owner_id=auth.uid() AND object_path=p_path;
   bucket:=coalesce(bucket,CASE WHEN layout=2 THEN 'users' ELSE 'user-files' END);
   physical:=CASE WHEN bucket='users' THEN auth.uid()||'/files/'||substring(p_path FROM length(auth.uid()::text)+2) ELSE p_path END;
 ELSE
   IF NOT public.can_read_user_file(p_path) THEN RAISE EXCEPTION 'File unavailable' USING ERRCODE='42501'; END IF;
   SELECT o.bucket_id,o.name,o.id INTO bucket,physical,object_id FROM streamly_internal.current_file_objects current
     JOIN storage.objects o ON o.id=current.id WHERE current.name=p_path;
   IF object_id IS NULL THEN RAISE EXCEPTION 'File unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN jsonb_build_object('bucket',bucket,'path',physical,'id',object_id);
END;
$$;
ALTER FUNCTION public.resolve_user_file_location(text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_user_file_location(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_user_file_location(text,boolean) TO authenticated;

CREATE FUNCTION public.create_user_file_folder(p_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.active_account(auth.uid()) OR NOT streamly_internal.valid_file_path(p_path,auth.uid()) THEN
   RAISE EXCEPTION 'Invalid folder' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=2 AND NOT pause_library_writes) THEN
   RAISE EXCEPTION 'The new storage layout is not active' USING ERRCODE='55000'; END IF;
 INSERT INTO public.user_file_metadata(owner_id,object_path,is_folder,storage_bucket) VALUES(auth.uid(),p_path,true,'users');
END;
$$;
ALTER FUNCTION public.create_user_file_folder(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_user_file_folder(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_user_file_folder(text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
