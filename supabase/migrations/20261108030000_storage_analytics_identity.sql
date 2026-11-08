-- Preserve analytics/event identities while rebinding the physical file FK.
-- Preparation does not change any counter, owner or existing file binding.
BEGIN;
CREATE FUNCTION streamly_internal.canonical_file_id(p_storage uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT old_object_id FROM streamly_internal.storage_migration_objects
   WHERE resource_type='file' AND new_object_id=p_storage AND retired_at IS NOT NULL),p_storage);
$$;
ALTER FUNCTION streamly_internal.canonical_file_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.canonical_file_id(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE VIEW streamly_internal.analytics_file_objects AS
 SELECT (jsonb_populate_record(NULL::storage.objects,to_jsonb(o)||jsonb_build_object(
   'id',streamly_internal.canonical_file_id(o.id),
   'created_at',coalesce((SELECT a.old_created_at FROM streamly_internal.storage_migration_objects a
     WHERE a.resource_type='file' AND a.new_object_id=o.id AND a.retired_at IS NOT NULL),o.created_at)))).*
 FROM streamly_internal.current_file_objects o;
ALTER VIEW streamly_internal.analytics_file_objects OWNER TO postgres;
REVOKE ALL ON streamly_internal.analytics_file_objects FROM PUBLIC,anon,authenticated,service_role;

-- A generated file_id=content_id would cascade away counters when the old copy
-- is eventually removed. Keep content_id stable, but bind file_id to the active
-- actual object. Existing FKs/views/indexes and all stored values are preserved.
ALTER TABLE public.analytics_content ALTER COLUMN file_id DROP EXPRESSION;
CREATE FUNCTION public.bind_analytics_file_object() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.content_type='file' THEN
   SELECT coalesce((SELECT a.new_object_id FROM streamly_internal.storage_migration_objects a
     JOIN public.user_file_metadata m ON m.source_id=a.new_object_id AND m.public_id=a.resource_id
     WHERE a.resource_type='file' AND a.old_object_id=NEW.content_id AND a.retired_at IS NOT NULL),NEW.content_id)
     INTO NEW.file_id;
 ELSE NEW.file_id:=NULL; END IF;
 RETURN NEW;
END;
$$;
ALTER FUNCTION public.bind_analytics_file_object() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bind_analytics_file_object() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bind_analytics_file_object BEFORE INSERT OR UPDATE OF content_type,content_id,file_id ON public.analytics_content
 FOR EACH ROW EXECUTE FUNCTION public.bind_analytics_file_object();
ALTER TABLE public.analytics_content ADD CONSTRAINT analytics_file_binding_kind
 CHECK((content_type='file')=(file_id IS NOT NULL));

-- Retain the existing event, quota, authorization, duplicate-request and counter
-- logic verbatim. Only the private file catalog/identity projection changes.
DO $$
DECLARE definition text; revised text; item text;
BEGIN
 definition:=pg_get_functiondef('public.analytics_record(text,text,uuid,uuid,text,uuid)'::regprocedure);
 IF position('storage.objects' IN definition)=0 OR position('IF p_type=''file'' THEN' IN definition)=0 THEN
   RAISE EXCEPTION 'Unexpected analytics record contract'; END IF;
 revised:=replace(definition,'storage.objects','streamly_internal.analytics_file_objects');
 revised:=replace(revised,'IF p_type=''file'' THEN','IF p_type=''file'' THEN source:=streamly_internal.canonical_file_id(source);');
 EXECUTE revised;
 definition:=pg_get_functiondef('public.analytics_source_change()'::regprocedure);
 IF position('NEW.bucket_id<>''user-files''' IN definition)=0 OR position('source:=NEW.id;' IN definition)=0 THEN
   RAISE EXCEPTION 'Unexpected analytics source contract'; END IF;
 revised:=replace(definition,'NEW.bucket_id<>''user-files''',
   '(NEW.bucket_id<>''user-files'' AND NOT (NEW.bucket_id=''users'' AND split_part(NEW.name,''/'',2)=''files'' AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=2)))');
 revised:=replace(revised,'kind:=''file''; source:=NEW.id;','kind:=''file''; source:=streamly_internal.canonical_file_id(NEW.id);');
 IF revised=definition THEN RAISE EXCEPTION 'Analytics source patch did not apply'; END IF;
 EXECUTE revised;
 definition:=pg_get_functiondef('public.analytics_refresh_owner()'::regprocedure);
 IF position('content_id = NEW.id' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected analytics owner contract'; END IF;
 EXECUTE replace(definition,'content_id = NEW.id',
   'content_id = CASE WHEN TG_TABLE_SCHEMA=''storage'' THEN streamly_internal.canonical_file_id(NEW.id) ELSE NEW.id END');
 FOREACH item IN ARRAY ARRAY['public.analytics_catalog','public.analytics_personal_catalog'] LOOP
   definition:=pg_get_viewdef(item::regclass,true);
   IF position('storage.objects' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected analytics view: %',item; END IF;
   EXECUTE 'CREATE OR REPLACE VIEW '||item||' AS '||replace(definition,'storage.objects','streamly_internal.analytics_file_objects');
 END LOOP;
END $$;

CREATE OR REPLACE VIEW public.analytics_media_objects AS
 SELECT DISTINCT m.owner_id,CASE WHEN m.resource_type='video' THEN 'Videos' ELSE 'Photos' END AS category,
   m.bucket_id,m.object_path AS name FROM streamly_internal.library_media_objects m;

CREATE OR REPLACE VIEW public.analytics_personal_storage AS
 WITH media AS (
   SELECT DISTINCT m.owner_id,CASE WHEN m.resource_type='video' THEN 'Videos' ELSE 'Photos' END AS category,
     m.bucket_id,m.object_path FROM streamly_internal.library_media_objects m
   WHERE m.resource_type='video' AND m.media_role IN ('original','final')
     OR m.resource_type='photo' AND m.media_role='original'
 ) SELECT m.owner_id,m.category,sum(greatest(0,coalesce((o.metadata->>'size')::bigint,0))) AS bytes
 FROM media m JOIN storage.objects o ON o.bucket_id=m.bucket_id AND o.name=m.object_path GROUP BY m.owner_id,m.category
 UNION ALL SELECT owner_id,'Files',sum(greatest(0,file_size)) FROM public.analytics_personal_catalog
 WHERE content_type='file' GROUP BY owner_id;

CREATE OR REPLACE VIEW public.analytics_object_inventory AS
 SELECT o.id,o.bucket_id,o.name,greatest(0,coalesce((o.metadata->>'size')::bigint,0)) AS bytes,
   coalesce(m.category,CASE WHEN o.bucket_id='user-videos' THEN 'Videos'
     WHEN o.bucket_id='user-images' AND (position('/videos/' IN '/'||o.name)>0 OR position('/video-previews/' IN '/'||o.name)>0) THEN 'Videos'
     WHEN o.bucket_id='user-images' THEN 'Photos' WHEN o.bucket_id='user-files' THEN 'Files'
     WHEN o.bucket_id='users' THEN CASE split_part(o.name,'/',2) WHEN 'videos' THEN 'Videos' WHEN 'photos' THEN 'Photos' WHEN 'files' THEN 'Files' ELSE 'Other application data' END
     WHEN o.bucket_id IN ('file-previews','cache') THEN 'Preview cache'
     WHEN o.bucket_id IN ('media-staging','staging') THEN 'Temporary / processing' ELSE 'Other application data' END) AS category,
   coalesce(m.owner_id,p.id) AS owner_id
 FROM storage.objects o LEFT JOIN (
   SELECT DISTINCT ON(bucket_id,name) bucket_id,name,owner_id,category FROM public.analytics_media_objects
   ORDER BY bucket_id,name,category,owner_id
 ) m ON m.bucket_id=o.bucket_id AND m.name=o.name
 LEFT JOIN public.profiles p ON p.id::text=substring(o.name FROM '(?:^|/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/|$)');
NOTIFY pgrst,'reload schema';
COMMIT;
