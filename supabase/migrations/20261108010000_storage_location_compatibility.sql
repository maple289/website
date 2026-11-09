-- Preparation only: all existing rows retain their legacy buckets. Activation
-- requires a separately verified manifest, a drained write gate and backups.
BEGIN;
ALTER TABLE public.videos
  ADD COLUMN storage_bucket text NOT NULL DEFAULT 'user-videos' CHECK(storage_bucket IN ('user-videos','users')),
  ADD COLUMN preview_bucket text NOT NULL DEFAULT 'user-images' CHECK(preview_bucket IN ('user-images','users'));
ALTER TABLE public.photos
  ADD COLUMN storage_bucket text NOT NULL DEFAULT 'user-images' CHECK(storage_bucket IN ('user-images','users'));
ALTER TABLE public.user_file_metadata
  ADD COLUMN storage_bucket text NOT NULL DEFAULT 'user-files' CHECK(storage_bucket IN ('user-files','users'));

-- Not a foreign key to storage.objects: retirement must survive deletion of
-- either copy, or a retained rollback object could become readable again.
CREATE TABLE streamly_internal.storage_migration_objects (
  old_object_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  resource_type text NOT NULL CHECK(resource_type IN ('video','photo','file','folder')),
  resource_id uuid NOT NULL,
  media_role text NOT NULL CHECK(media_role IN ('original','final','preview','thumbnail','file','folder')),
  old_bucket text NOT NULL CHECK(old_bucket IN ('user-videos','user-images','user-files')),
  old_key text NOT NULL,
  old_version text NOT NULL,
  old_created_at timestamptz,
  old_updated_at timestamptz,
  new_object_id uuid,
  new_bucket text CHECK(new_bucket='users'),
  new_key text,
  new_version text,
  bytes bigint NOT NULL CHECK(bytes>=0),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  retired_at timestamptz,
  CHECK(retired_at IS NULL OR old_created_at IS NOT NULL AND old_updated_at IS NOT NULL),
  UNIQUE(old_bucket,old_key),
  UNIQUE(new_bucket,new_key),
  CHECK((resource_type='folder' AND new_object_id IS NULL AND new_bucket IS NULL
    AND new_key IS NULL AND new_version IS NULL) OR
    (resource_type<>'folder' AND new_object_id IS NOT NULL AND new_bucket IS NOT NULL
      AND new_key IS NOT NULL AND new_version IS NOT NULL)),
  CHECK(new_key IS NULL OR starts_with(new_key,owner_id::text||'/'||
    CASE resource_type WHEN 'video' THEN 'videos/' WHEN 'photo' THEN 'photos/' ELSE 'files/' END))
);
ALTER TABLE streamly_internal.storage_migration_objects OWNER TO postgres;
REVOKE ALL ON streamly_internal.storage_migration_objects FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION streamly_internal.media_object_key(p_bucket text,p_path text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN p_path IS NULL THEN NULL WHEN p_bucket='users' THEN p_path
   WHEN p_bucket IN ('user-videos','user-images') THEN concat_ws('/',nullif(btrim(
     CASE WHEN p_bucket='user-videos' THEN s.videos_base_path ELSE s.images_base_path END,'/'),''),p_path)
   END FROM (SELECT 1) one LEFT JOIN public.storage_settings s ON s.id=1;
$$;
ALTER FUNCTION streamly_internal.media_object_key(text,text) OWNER TO postgres;

CREATE VIEW streamly_internal.library_media_objects AS
 SELECT v.id AS resource_id,'video'::text AS resource_type,v.owner_id,
   k.media_role,k.bucket_id,streamly_internal.media_object_key(k.bucket_id,k.path) AS object_path,
   v.file_name,CASE WHEN k.media_role='preview' THEN 'image/webp' ELSE coalesce(v.mime_type,'video/mp4') END AS mime_type,
   v.visibility,v.processing_status='ready' AS ready
 FROM public.videos v CROSS JOIN LATERAL (VALUES
   ('original',v.storage_bucket,v.storage_path),('final',v.storage_bucket,coalesce(v.processed_storage_path,v.storage_path)),
   ('preview',v.preview_bucket,v.preview_path)) k(media_role,bucket_id,path) WHERE k.path IS NOT NULL
 UNION ALL
 SELECT p.id,'photo',p.owner_id,k.media_role,p.storage_bucket,
   streamly_internal.media_object_key(p.storage_bucket,k.path),p.file_name,
   CASE WHEN k.media_role='original' THEN p.mime_type ELSE 'image/webp' END,p.visibility,true
 FROM public.photos p CROSS JOIN LATERAL (VALUES
   ('original',p.storage_path),('preview',p.preview_path),('thumbnail',p.thumbnail_path)) k(media_role,path)
 WHERE k.path IS NOT NULL;
ALTER VIEW streamly_internal.library_media_objects OWNER TO postgres;
REVOKE ALL ON streamly_internal.library_media_objects FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION streamly_internal.media_object_key(text,text) FROM PUBLIC,anon,authenticated,service_role;

-- This helper always resolves a CURRENT database record, including old URLs
-- registered in the verified manifest. An alias alone never grants access.
CREATE FUNCTION streamly_internal.resolve_library_image(p_path text,p_bucket text DEFAULT NULL)
RETURNS SETOF streamly_internal.library_media_objects
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT m.* FROM streamly_internal.library_media_objects m
 WHERE (m.resource_type='photo' OR m.media_role='preview')
   AND position('/'||m.owner_id::text||'/' IN '/'||m.object_path)>0
   AND m.object_path !~ '(^|/)(\.|\.\.)(/|$)' AND position(chr(92) IN m.object_path)=0
   AND position('//' IN m.object_path)=0
   AND ((m.object_path=p_path AND (p_bucket IS NULL OR m.bucket_id=p_bucket)) OR EXISTS(
     SELECT 1 FROM streamly_internal.storage_migration_objects a
     WHERE a.resource_type=m.resource_type AND a.resource_id=m.resource_id
       AND a.owner_id=m.owner_id AND a.media_role=m.media_role
       AND a.old_key=p_path AND (p_bucket IS NULL OR a.old_bucket=p_bucket)));
$$;
ALTER FUNCTION streamly_internal.resolve_library_image(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.resolve_library_image(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.resolve_public_library_image(p_path text,p_bucket text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('bucket',m.bucket_id,'object_path',m.object_path,
   'name',m.file_name,'mime',m.mime_type)
 FROM streamly_internal.resolve_library_image(p_path,p_bucket) m
 WHERE m.visibility='public' AND m.ready LIMIT 1;
$$;
ALTER FUNCTION public.resolve_public_library_image(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_public_library_image(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_library_image(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_shared_image(p_path text,p_user uuid,p_session uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('bucket',m.bucket_id,'object_path',m.object_path,
   'path',m.object_path,'name',m.file_name,'mime',m.mime_type)
 FROM streamly_internal.resolve_library_image(p_path,NULL) m
 WHERE public.active_account(p_user) AND EXISTS(SELECT 1 FROM auth.sessions
   WHERE id=p_session AND user_id=p_user AND (not_after IS NULL OR not_after>now()))
   AND public.media_access_for_user(m.resource_type,m.resource_id,p_user) LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.check_shared_image(p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.resolve_shared_image(g.object_path,g.user_id,g.session_id)
 FROM public.image_access_grants g WHERE g.token_hash=p_hash AND g.expires_at>now();
$$;
ALTER FUNCTION public.resolve_shared_image(text,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.check_shared_image(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_shared_image(text,uuid,uuid),public.check_shared_image(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_shared_image(text,uuid,uuid),public.check_shared_image(text) TO service_role;

-- Keep old objects for rollback, but never revive retired copies after the
-- current resource is made private, moved or deleted. Restrictive policy composes
-- with existing owner/public/shared rules; it grants no access by itself.
CREATE FUNCTION public.is_retired_library_object(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM streamly_internal.storage_migration_objects
   WHERE old_object_id=p_id AND retired_at IS NOT NULL);
$$;
ALTER FUNCTION public.is_retired_library_object(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_retired_library_object(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_retired_library_object(uuid) TO anon,authenticated;
CREATE POLICY library_retired_object_read_guard ON storage.objects AS RESTRICTIVE
 FOR SELECT TO anon,authenticated USING(NOT public.is_retired_library_object(id));

-- Photo cleanup includes retained rollback copies, but only for an existing
-- photo owned by the current active user. The existing confirmed UI action calls
-- this resolver; Storage DELETE RLS remains an independent authority.
CREATE FUNCTION public.photo_deletion_objects(p_id uuid,p_owner uuid)
RETURNS TABLE(bucket_id text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT o.bucket_id,o.name FROM storage.objects o
 WHERE EXISTS(SELECT 1 FROM public.photos p WHERE p.id=p_id AND p.owner_id=p_owner
   AND public.active_account(p_owner)) AND (
   EXISTS(SELECT 1 FROM streamly_internal.library_media_objects m WHERE m.resource_type='photo'
     AND m.resource_id=p_id AND m.owner_id=p_owner AND m.bucket_id=o.bucket_id AND m.object_path=o.name)
   OR EXISTS(SELECT 1 FROM streamly_internal.storage_migration_objects a WHERE a.resource_type='photo'
     AND a.resource_id=p_id AND a.owner_id=p_owner AND a.old_object_id=o.id
     AND a.old_bucket=o.bucket_id AND a.old_key=o.name AND a.old_version=o.version));
$$;
ALTER FUNCTION public.photo_deletion_objects(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.photo_deletion_objects(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.photo_deletion_objects(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.video_deletion_objects(p_id uuid,p_owner uuid)
RETURNS TABLE(bucket_id text,name text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT o.bucket_id,o.name FROM storage.objects o
 WHERE EXISTS(SELECT 1 FROM public.video_deletions WHERE id=p_id AND owner_id=p_owner) AND (
   (o.bucket_id='user-videos' AND o.name ~ ('(^|/)'||p_owner||'/videos/'||p_id||'/'))
   OR (o.bucket_id='user-images' AND o.name ~ ('(^|/)'||p_owner||'/video-previews/'||p_id||'/'))
   OR (o.bucket_id='users' AND starts_with(o.name,p_owner||'/videos/'||p_id||'/'))
   OR (o.bucket_id='media-staging' AND EXISTS(SELECT 1 FROM public.media_upload_jobs j
     WHERE j.owner_id=p_owner AND (j.id=p_id OR j.target_video_id=p_id)
       AND o.name IN (p_owner||'/'||j.id||'/source',p_owner||'/'||j.id||'/preview')))
   OR EXISTS(SELECT 1 FROM streamly_internal.library_media_objects m
     WHERE m.resource_type='video' AND m.resource_id=p_id AND m.owner_id=p_owner
       AND m.bucket_id=o.bucket_id AND m.object_path=o.name)
   OR EXISTS(SELECT 1 FROM streamly_internal.storage_migration_objects a
     WHERE a.resource_type='video' AND a.resource_id=p_id AND a.owner_id=p_owner
       AND a.old_object_id=o.id AND a.old_bucket=o.bucket_id AND a.old_key=o.name AND a.old_version=o.version)
 ) ORDER BY o.bucket_id,o.name;
$$;

CREATE OR REPLACE FUNCTION public.get_file_preview_source(p_path text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',o.id,'bucket',o.bucket_id,'path',o.name,
   'version',coalesce(o.version,'')||':'||o.updated_at::text,
   'size',coalesce((o.metadata->>'size')::bigint,0),
   'mime',coalesce(o.metadata->>'mimetype','application/octet-stream'))
 FROM storage.objects o JOIN public.user_file_metadata m ON (m.source_id=o.id OR
   (m.source_id IS NULL AND m.storage_bucket='user-files' AND o.bucket_id='user-files' AND o.name=m.object_path))
 WHERE m.object_path=p_path AND NOT m.is_folder AND m.storage_bucket=o.bucket_id
   AND (o.bucket_id='user-files' AND o.name=m.object_path OR o.bucket_id='users'
     AND o.name=m.owner_id||'/files/'||substring(m.object_path FROM length(m.owner_id::text)+2))
   AND NOT public.is_retired_library_object(o.id);
$$;
CREATE OR REPLACE FUNCTION public.get_preview_source_by_id(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',o.id,'bucket',o.bucket_id,'path',o.name,
   'version',coalesce(o.version,'')||':'||o.updated_at::text,
   'size',coalesce((o.metadata->>'size')::bigint,0),
   'mime',coalesce(o.metadata->>'mimetype','application/octet-stream'))
 FROM storage.objects o WHERE o.id=p_id AND (o.bucket_id='messenger-attachments' OR
   (o.bucket_id IN ('user-files','users') AND EXISTS(SELECT 1 FROM public.user_file_metadata m
     WHERE (m.source_id=o.id OR (m.source_id IS NULL AND m.storage_bucket='user-files' AND o.name=m.object_path))
       AND NOT m.is_folder AND m.storage_bucket=o.bucket_id
       AND (o.bucket_id='user-files' AND o.name=m.object_path OR o.bucket_id='users'
         AND o.name=m.owner_id||'/files/'||substring(m.object_path FROM length(m.owner_id::text)+2)))))
   AND NOT public.is_retired_library_object(o.id);
$$;
ALTER FUNCTION public.get_file_preview_source(text) OWNER TO postgres;
ALTER FUNCTION public.get_preview_source_by_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_file_preview_source(text),public.get_preview_source_by_id(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_file_preview_source(text),public.get_preview_source_by_id(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
