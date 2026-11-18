-- Keep user-visible names in UTF-8. Storage's object API rejects non-ASCII keys.
-- Use a separate, reversible namespace only for names the object API cannot use.
-- Existing ASCII keys and all saved virtual transfer plans remain unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION streamly_internal.file_storage_key(p_path text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE account text:=split_part(p_path,'/',1); tail text; result text;
BEGIN
 IF NOT streamly_internal.valid_file_path(p_path,account::uuid) THEN
   RAISE EXCEPTION 'Invalid file path' USING ERRCODE='22023'; END IF;
 tail:=substring(p_path FROM length(account)+2);
 IF tail COLLATE "C" ~ '^[A-Za-z0-9/!_.*''() &$@=;:+,?-]+$' THEN
   result:=account||'/files/'||tail;
 ELSE
   SELECT account||'/files-utf8/'||string_agg(encode(convert_to(segment,'UTF8'),'hex'),'/' ORDER BY ordinal)
   INTO result FROM unnest(string_to_array(tail,'/')) WITH ORDINALITY AS parts(segment,ordinal);
 END IF;
 IF octet_length(result)>1024 THEN
   RAISE EXCEPTION 'The file name or folder path is too long for storage. Use a shorter name or a shallower folder.' USING ERRCODE='22023'; END IF;
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION streamly_internal.file_virtual_path(p_key text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE account text:=split_part(p_key,'/',1); namespace text:=split_part(p_key,'/',2); tail text; result text;
BEGIN
 IF namespace='files' THEN
   result:=account||'/'||substring(p_key FROM length(account)+8);
 ELSIF namespace='files-utf8' THEN
   tail:=substring(p_key FROM length(account)+13);
   IF EXISTS(SELECT 1 FROM unnest(string_to_array(tail,'/')) segment
     WHERE segment !~ '^([0-9a-f]{2})+$') THEN RETURN NULL; END IF;
   SELECT account||'/'||string_agg(convert_from(decode(segment,'hex'),'UTF8'),'/' ORDER BY ordinal)
   INTO result FROM unnest(string_to_array(tail,'/')) WITH ORDINALITY AS parts(segment,ordinal);
   -- Reject alternate encodings, encoded slashes/dot segments, and ASCII aliases.
   IF streamly_internal.file_storage_key(result) IS DISTINCT FROM p_key THEN RETURN NULL; END IF;
 ELSE RETURN NULL; END IF;
 IF NOT streamly_internal.valid_file_path(result,account::uuid) THEN RETURN NULL; END IF;
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR character_not_in_repertoire OR untranslatable_character OR invalid_parameter_value THEN
 RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION streamly_internal.file_key_matches(p_key text,p_path text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT streamly_internal.file_virtual_path(p_key)=p_path;
$$;
ALTER FUNCTION streamly_internal.file_storage_key(text) OWNER TO postgres;
ALTER FUNCTION streamly_internal.file_virtual_path(text) OWNER TO postgres;
ALTER FUNCTION streamly_internal.file_key_matches(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.file_storage_key(text),streamly_internal.file_virtual_path(text),streamly_internal.file_key_matches(text,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE VIEW streamly_internal.current_file_objects AS
 SELECT o.* FROM storage.objects o WHERE o.bucket_id='user-files'
   AND NOT public.is_retired_library_object(o.id)
   AND NOT EXISTS(SELECT 1 FROM public.user_file_metadata m WHERE m.storage_bucket='users'
     AND (m.object_path=o.name OR m.is_folder AND o.name IN (m.object_path||'/.folder',m.object_path||'/.keep')))
 UNION ALL
 SELECT (jsonb_populate_record(NULL::storage.objects,to_jsonb(o)||jsonb_build_object(
   'bucket_id','user-files','name',m.object_path,'path_tokens',string_to_array(m.object_path,'/')))).*
 FROM storage.objects o JOIN public.user_file_metadata m ON m.source_id=o.id AND NOT m.is_folder
 WHERE o.bucket_id='users' AND m.storage_bucket='users'
   AND streamly_internal.file_key_matches(o.name,m.object_path)
 UNION ALL
 SELECT (jsonb_populate_record(NULL::storage.objects,to_jsonb(o)||jsonb_build_object(
   'bucket_id','user-files','name',streamly_internal.file_virtual_path(o.name),
   'path_tokens',string_to_array(streamly_internal.file_virtual_path(o.name),'/')))).*
 FROM storage.objects o JOIN public.user_file_metadata m ON m.is_folder AND m.storage_bucket='users'
 WHERE o.bucket_id='users' AND (streamly_internal.file_key_matches(o.name,m.object_path||'/.folder')
   OR streamly_internal.file_key_matches(o.name,m.object_path||'/.keep'));

CREATE OR REPLACE FUNCTION public.resolve_user_file_location(p_path text,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE bucket text; physical text; object_id uuid; layout smallint;
BEGIN
 IF NOT public.active_account(auth.uid()) THEN RAISE EXCEPTION 'Please sign in' USING ERRCODE='42501'; END IF;
 IF p_write THEN
   IF NOT streamly_internal.valid_file_path(p_path,auth.uid()) THEN RAISE EXCEPTION 'Invalid destination' USING ERRCODE='42501'; END IF;
   SELECT layout_version INTO layout FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes;
   IF layout IS NULL THEN RAISE EXCEPTION 'Storage maintenance is in progress' USING ERRCODE='55000'; END IF;
   SELECT m.storage_bucket,o.name INTO bucket,physical FROM public.user_file_metadata m
     LEFT JOIN storage.objects o ON o.id=m.source_id AND o.bucket_id=m.storage_bucket
       AND (o.bucket_id='user-files' AND o.name=p_path OR o.bucket_id='users' AND streamly_internal.file_key_matches(o.name,p_path))
     WHERE m.owner_id=auth.uid() AND m.object_path=p_path;
   bucket:=coalesce(bucket,CASE WHEN layout=2 THEN 'users' ELSE 'user-files' END);
   physical:=coalesce(physical,CASE WHEN bucket='users' THEN streamly_internal.file_storage_key(p_path) ELSE p_path END);
 ELSE
   IF NOT public.can_read_user_file(p_path) THEN RAISE EXCEPTION 'File unavailable' USING ERRCODE='42501'; END IF;
   SELECT o.bucket_id,o.name,o.id INTO bucket,physical,object_id FROM streamly_internal.current_file_objects current
     JOIN storage.objects o ON o.id=current.id WHERE current.name=p_path;
   IF object_id IS NULL THEN RAISE EXCEPTION 'File unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN jsonb_build_object('bucket',bucket,'path',physical,'id',object_id);
END;
$$;

-- Preserve the existing guards and storage/catalog triggers. Change only their
-- physical/virtual conversion, including preview and permanent-deletion locks.
DO $patch$
DECLARE signature text; definition text; revised text; owner_path text; expected text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
   'public.guard_file_metadata_source()', 'public.sync_file_catalog_metadata()',
   'public.can_read_user_library_object(uuid,text)', 'public.can_read_owned_library_file(text,text)',
   'public.can_write_user_library_file(text)', 'public.guard_pending_file_storage()',
   'public.get_file_preview_source(text)', 'public.get_preview_source_by_id(uuid)',
   'public.invalidate_file_previews_metadata()', 'public.queue_file_preview(uuid,text,text)'
 ] LOOP
   -- Preview functions are installed separately in small isolated DB fixtures.
   IF to_regprocedure(signature) IS NULL THEN
     IF signature IN ('public.get_file_preview_source(text)','public.get_preview_source_by_id(uuid)',
       'public.invalidate_file_previews_metadata()','public.queue_file_preview(uuid,text,text)') THEN CONTINUE; END IF;
     RAISE EXCEPTION 'Missing file storage function: %',signature;
   END IF;
   definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),''); revised:=definition;
   IF signature='public.guard_file_metadata_source()' THEN
     expected:='streamly_internal.file_storage_key(NEW.object_path)';
     revised:=replace(revised, 'NEW.owner_id||''/files/''||substring(NEW.object_path FROM length(NEW.owner_id::text)+2)',
       'streamly_internal.file_storage_key(NEW.object_path)');
     revised:=replace(revised, 'name=physical;',
       '(name=physical OR NEW.storage_bucket=''users'' AND streamly_internal.file_key_matches(name,NEW.object_path)) ORDER BY (id=NEW.source_id) DESC NULLS LAST LIMIT 1;');
   ELSIF signature='public.sync_file_catalog_metadata()' THEN
     expected:='streamly_internal.file_virtual_path(object_row.name)';
     revised:=replace(revised, 'split_part(object_row.name,''/'',2)<>''files''',
       'split_part(object_row.name,''/'',2) NOT IN (''files'',''files-utf8'')');
     revised:=replace(revised, 'split_part(object_row.name,''/'',1)||''/''||substring(object_row.name FROM length(split_part(object_row.name,''/'',1))+8)',
       'streamly_internal.file_virtual_path(object_row.name)');
     revised:=replace(revised, 'split_part(OLD.name,''/'',1)||''/''||substring(OLD.name FROM length(split_part(OLD.name,''/'',1))+8)',
       'streamly_internal.file_virtual_path(OLD.name)');
   ELSIF signature IN ('public.can_read_user_library_object(uuid,text)','public.get_file_preview_source(text)','public.get_preview_source_by_id(uuid)') THEN
     expected:='streamly_internal.file_key_matches(';
     owner_path:='m.owner_id||''/files/''||substring(m.object_path FROM length(m.owner_id::text)+2)';
     revised:=replace(revised, 'o.name='||owner_path, 'streamly_internal.file_key_matches(o.name,m.object_path)');
     revised:=replace(revised, 'p_name='||owner_path, 'streamly_internal.file_key_matches(p_name,m.object_path)');
     revised:=replace(revised, 'p_name IN ('||owner_path||'||''/.folder'','||chr(10)||'         '||owner_path||'||''/.keep'')',
       '(streamly_internal.file_key_matches(p_name,m.object_path||''/.folder'') OR streamly_internal.file_key_matches(p_name,m.object_path||''/.keep''))');
   ELSIF signature IN ('public.can_read_owned_library_file(text,text)','public.can_write_user_library_file(text)') THEN
     expected:='streamly_internal.file_virtual_path(p_name)';
     revised:=replace(revised, 'starts_with(p_name,auth.uid()::text||''/files/'')',
       'streamly_internal.file_virtual_path(p_name) IS NOT NULL AND starts_with(streamly_internal.file_virtual_path(p_name),auth.uid()::text||''/'')');
   ELSIF signature='public.guard_pending_file_storage()' THEN
     expected:='streamly_internal.file_virtual_path(NEW.name)';
     revised:=replace(revised, 'WHEN split_part(NEW.name,''/'',2)=''files'''||chr(10)||'     THEN split_part(NEW.name,''/'',1)||''/''||substring(NEW.name FROM length(split_part(NEW.name,''/'',1))+8)',
       'ELSE streamly_internal.file_virtual_path(NEW.name)');
     revised:=replace(revised, 'WHEN split_part(OLD.name,''/'',2)=''files'''||chr(10)||'     THEN split_part(OLD.name,''/'',1)||''/''||substring(OLD.name FROM length(split_part(OLD.name,''/'',1))+8)',
       'ELSE streamly_internal.file_virtual_path(OLD.name)');
   ELSIF signature='public.invalidate_file_previews_metadata()' THEN
     expected:='streamly_internal.file_virtual_path(object_path)';
     revised:=replace(revised, 'object_path=OLD.owner_id||''/files/''||substring(OLD.object_path FROM length(OLD.owner_id::text)+2)',
       'streamly_internal.file_key_matches(object_path,OLD.object_path)');
     revised:=replace(revised, 'starts_with(object_path,OLD.owner_id||''/files/''||substring(OLD.object_path FROM length(OLD.owner_id::text)+2)||''/'')',
       'starts_with(streamly_internal.file_virtual_path(object_path),OLD.object_path||''/'')');
   ELSIF signature='public.queue_file_preview(uuid,text,text)' THEN
     expected:='streamly_internal.file_virtual_path(source.name)';
     revised:=replace(revised, 'regexp_replace(source.name,''^.*\.'','''')',
       'regexp_replace(CASE WHEN source.bucket_id=''users'' THEN streamly_internal.file_virtual_path(source.name) ELSE source.name END,''^.*\.'','''')');
   END IF;
   IF position(expected IN revised)=0 THEN
     RAISE EXCEPTION 'Unexpected file storage function definition: %',signature;
   END IF;
   EXECUTE revised;
 END LOOP;
END;
$patch$;

DO $analytics$
DECLARE definition text; revised text;
BEGIN
 IF to_regprocedure('public.analytics_source_change()') IS NOT NULL THEN
   definition:=pg_get_functiondef('public.analytics_source_change()'::regprocedure);
   revised:=replace(definition, 'split_part(NEW.name,''/'',2)=''files''',
     'streamly_internal.file_virtual_path(NEW.name) IS NOT NULL');
   revised:=replace(revised, 'regexp_replace(NEW.name,''^.*/'','''') IN (''.folder'',''.keep'')',
     'regexp_replace(CASE WHEN NEW.bucket_id=''users'' THEN streamly_internal.file_virtual_path(NEW.name) ELSE NEW.name END,''^.*/'','''') IN (''.folder'',''.keep'')');
   IF position('streamly_internal.file_virtual_path(NEW.name)' IN revised)=0 THEN
     RAISE EXCEPTION 'Unexpected analytics file namespace contract'; END IF;
   EXECUTE revised;
 END IF;
 IF to_regclass('public.analytics_object_inventory') IS NOT NULL THEN
   definition:=pg_get_viewdef('public.analytics_object_inventory'::regclass,true);
   revised:=definition;
   IF position('''files-utf8''' IN definition)=0 THEN
     revised:=replace(definition, 'WHEN ''files''::text THEN ''Files''::text',
       'WHEN ''files''::text THEN ''Files''::text WHEN ''files-utf8''::text THEN ''Files''::text');
   END IF;
   IF position('''files-utf8''' IN revised)=0 THEN RAISE EXCEPTION 'Unexpected storage inventory namespace contract'; END IF;
   EXECUTE 'CREATE OR REPLACE VIEW public.analytics_object_inventory AS '||revised;
 END IF;
END;
$analytics$;

-- Existing receipts store virtual names. Resume resolves each physical key with
-- the new resolver; do not cancel, recreate or silently run saved transfers.
NOTIFY pgrst,'reload schema';
COMMIT;
