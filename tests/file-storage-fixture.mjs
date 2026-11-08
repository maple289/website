// Shared isolated PostgreSQL fixture. Never connects to production.
import { readFile } from 'node:fs/promises';
export async function setupFileStorageFixture(db, size=12) {
 const apply=async name=>db.exec(await readFile('supabase/migrations/'+name,'utf8'));
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE SCHEMA streamly_internal;
 GRANT USAGE ON SCHEMA auth,storage TO anon,authenticated,service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE auth.sessions(id uuid,user_id uuid,not_after timestamptz);
 CREATE TABLE profiles(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION active_account(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1)$$;
 CREATE FUNCTION media_access_for_user(text,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE videos(id uuid PRIMARY KEY,owner_id uuid,visibility text,processing_status text,storage_path text,processed_storage_path text,preview_path text,file_name text,mime_type text);
 CREATE TABLE photos(id uuid PRIMARY KEY,owner_id uuid,visibility text,storage_path text,preview_path text,thumbnail_path text,file_name text,mime_type text);
 CREATE TABLE storage_settings(id int PRIMARY KEY,videos_base_path text,images_base_path text);
 INSERT INTO storage_settings VALUES(1,'','');
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,version text DEFAULT gen_random_uuid()::text,
   created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),metadata jsonb DEFAULT '{"size":12,"mimetype":"text/plain"}');
 CREATE TABLE user_file_metadata(owner_id uuid,object_path text,is_folder boolean DEFAULT false,is_favorite boolean DEFAULT false,
   file_size bigint DEFAULT 0,mime_type text DEFAULT '',trashed_at timestamptz,public_id uuid UNIQUE DEFAULT gen_random_uuid(),
   created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(owner_id,object_path));
 GRANT SELECT,INSERT,UPDATE,DELETE ON user_file_metadata TO authenticated;
 ALTER TABLE user_file_metadata ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own_metadata ON user_file_metadata FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
 CREATE TABLE user_file_shares(owner_id uuid,object_path text,recipient_id uuid,
   FOREIGN KEY(owner_id,object_path) REFERENCES user_file_metadata(owner_id,object_path) ON UPDATE CASCADE ON DELETE CASCADE);
 CREATE FUNCTION can_read_user_file(p_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
   SELECT auth.uid() IS NOT NULL AND (starts_with(p_path,auth.uid()::text||'/') OR EXISTS(
     SELECT 1 FROM public.user_file_shares s JOIN public.user_file_metadata m USING(owner_id,object_path)
     WHERE s.recipient_id=auth.uid() AND m.trashed_at IS NULL AND (p_path=m.object_path OR m.is_folder AND starts_with(p_path,m.object_path||'/'))))$$;
 CREATE TABLE video_deletions(id uuid,owner_id uuid);
 CREATE TABLE media_upload_jobs(id uuid,owner_id uuid,kind text,target_video_id uuid,status text,result jsonb);
 CREATE TABLE image_access_grants(token_hash text,object_path text,user_id uuid,session_id uuid,expires_at timestamptz);
 CREATE TABLE streamly_internal.library_storage_control(id boolean PRIMARY KEY,layout_version smallint,pause_media_claims boolean,pause_library_writes boolean);
 INSERT INTO streamly_internal.library_storage_control VALUES(true,1,false,false);`.replace('\"size\":12','\"size\":'+size));
 if (!Number.isSafeInteger(size) || size < 0) throw Error('Invalid synthetic file size');
 await db.exec(`ALTER TABLE storage.objects ALTER COLUMN metadata SET DEFAULT '{"size":${size},"mimetype":"text/plain"}'::jsonb`);
 await apply('20260923010000_correct_user_file_manager_metadata.sql');
 await apply('20261003130000_file_catalog_integrity.sql');
 await apply('20261007010000_content_context_actions.sql');
 await apply('20261007020000_reuse_trashed_file_names.sql');
 await apply('20261012040000_durable_file_transfers.sql');
 await apply('20261108010000_storage_location_compatibility.sql');
 await apply('20261108020000_user_file_catalog_compatibility.sql');
 await apply('20261108040000_user_storage_authorization.sql');
 await apply('20261108050000_file_deletion_locations.sql');
 await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated,service_role;
   ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   CREATE POLICY fixture_legacy_owner ON storage.objects FOR ALL TO authenticated
   USING(bucket_id='user-files' AND starts_with(name,auth.uid()::text||'/'))
   WITH CHECK(bucket_id='user-files' AND starts_with(name,auth.uid()::text||'/'));`);
 await db.exec('ALTER TABLE storage.objects ADD CONSTRAINT fixture_object_key UNIQUE(bucket_id,name)');
}
