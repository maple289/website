// Actual forward SQL and access helpers, isolated from production and user media.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const owner = randomUUID(), member = randomUUID(), outsider = randomUUID();
const photo = randomUUID(), video = randomUUID(), group = randomUUID(), session = randomUUID();
const sql = async (text, args) => (await db.query(text, args)).rows;
const source = name => readFile('supabase/migrations/' + name, 'utf8');
const root = () => db.exec('RESET ROLE');
const service = () => db.exec('RESET ROLE; SET ROLE service_role');
const actor = async (role, id = '') => db.exec(`RESET ROLE; SET ROLE ${role}; SET request.jwt.claim.sub='${id}'`);
const resolve = async (path, user = member, sid = session) => {
  await service(); return (await sql('SELECT resolve_shared_image($1,$2,$3) value', [path, user, sid]))[0].value;
};
const publicImage = async path => {
  await service(); return (await sql('SELECT resolve_public_library_image($1) value', [path]))[0].value;
};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA streamly_internal;
    GRANT USAGE ON SCHEMA auth,storage TO anon,authenticated,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text);
    CREATE TABLE account_activation(user_id uuid,active boolean,must_change_password boolean);
    CREATE TABLE storage_settings(id int PRIMARY KEY,videos_base_path text,images_base_path text);
    INSERT INTO storage_settings VALUES(1,'media/videos','media/images');
    CREATE TABLE videos(id uuid PRIMARY KEY,owner_id uuid,visibility text,processing_status text,
      storage_path text,processed_storage_path text,preview_path text,preview_url text,file_name text,mime_type text);
    CREATE TABLE photos(id uuid PRIMARY KEY,owner_id uuid,visibility text,storage_path text,preview_path text,
      thumbnail_path text,file_name text,mime_type text);
    CREATE TABLE user_file_metadata(owner_id uuid,object_path text,is_folder boolean,source_id uuid,public_id uuid DEFAULT gen_random_uuid());
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,
      version text DEFAULT gen_random_uuid()::text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),metadata jsonb DEFAULT '{"size":12,"mimetype":"text/plain"}');
    CREATE TABLE video_deletions(id uuid PRIMARY KEY,owner_id uuid);
    CREATE TABLE media_upload_jobs(id uuid,owner_id uuid,kind text,target_video_id uuid,status text,result jsonb);
    CREATE TABLE messenger_conversations(id uuid PRIMARY KEY,kind text);
    CREATE TABLE messenger_members(conversation_id uuid,user_id uuid);
    CREATE TABLE media_shares(media_type text,media_id uuid,recipient_id uuid,group_id uuid);
    GRANT ALL ON videos,photos,storage.objects TO authenticated;
    GRANT SELECT ON storage.objects TO anon;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_owner ON storage.objects FOR SELECT TO authenticated USING(position('/'||auth.uid()||'/' IN '/'||name)>0);
    CREATE POLICY fixture_public ON storage.objects FOR SELECT TO anon USING(bucket_id='user-images');`);
  const account = (await source('20261012010000_account_security_boundaries.sql')).match(/CREATE FUNCTION public\.active_account[\s\S]*?\$\$;/)[0];
  const access = (await source('20261019010000_messenger_group_sharing.sql')).match(/CREATE FUNCTION public\.media_access_for_user[\s\S]*?\$\$;/)[0];
  await db.exec(account + '\n' + access);
  await db.exec(await source('20261019020000_shared_image_gateway.sql'));
  await db.exec(await source('20261108010000_storage_location_compatibility.sql'));
  for (const id of [owner, member, outsider]) {
    await sql('INSERT INTO auth.users(id) VALUES($1)', [id]);
    await sql("INSERT INTO profiles VALUES($1,'user')", [id]);
  }
  await sql('INSERT INTO auth.sessions VALUES($1,$2,NULL)', [session, member]);
  await sql("INSERT INTO messenger_conversations VALUES($1,'group')", [group]);
  await sql('INSERT INTO messenger_members VALUES($1,$2)', [group, member]);
  await sql("INSERT INTO photos(id,owner_id,visibility,storage_path,preview_path,thumbnail_path,file_name,mime_type) VALUES($1,$2,'public',$3,$4,$5,'Photo.jpg','image/jpeg')",
    [photo,owner,owner+'/old/photo.jpg',owner+'/old/preview.webp',owner+'/old/thumb.webp']);
  const oldPath = 'media/images/'+owner+'/old/preview.webp', newPath = owner+'/photos/'+photo+'/preview.webp';
  assert.equal((await publicImage(oldPath)).bucket,'user-images','Legacy prefixes must resolve exactly');
  assert.equal(await publicImage('other/'+oldPath),null);
  await root();
  const [oldObject] = await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('user-images',$1) RETURNING *",[oldPath]);
  const [newObject] = await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('users',$1) RETURNING *",[newPath]);
  await sql(`INSERT INTO streamly_internal.storage_migration_objects(old_object_id,owner_id,resource_type,resource_id,media_role,
    old_bucket,old_key,old_version,new_object_id,new_bucket,new_key,new_version,bytes,sha256,verified_at)
    VALUES($1,$2,'photo',$3,'preview','user-images',$4,$5,$6,'users',$7,$8,12,repeat('a',64),now())`,
    [oldObject.id,owner,photo,oldPath,oldObject.version,newObject.id,newPath,newObject.version]);
  await actor('anon'); assert.equal((await sql("SELECT * FROM storage.objects WHERE bucket_id='users'")).length,0);
  await assert.rejects(sql('SELECT * FROM streamly_internal.storage_migration_objects'),/permission denied/);
  await assert.rejects(sql('SELECT resolve_public_library_image($1)',[oldPath]),/permission denied/);
  await assert.rejects(sql('SELECT get_file_preview_source($1)',[oldPath]),/permission denied/);
  await assert.rejects(sql('SELECT get_preview_source_by_id($1)',[oldObject.id]),/permission denied/);
  console.log('PASS existing prefixes resolve exactly; private preparations and migration registry are unavailable to anonymous clients');
  await root();
  await sql("UPDATE photos SET storage_bucket='users',storage_path=$2,preview_path=$3,thumbnail_path=$4 WHERE id=$1",
    [photo,owner+'/photos/'+photo+'/photo.jpg',newPath,owner+'/photos/'+photo+'/thumbnail.webp']);
  await sql('UPDATE streamly_internal.storage_migration_objects SET retired_at=now(),old_created_at=$1,old_updated_at=$2',[oldObject.created_at,oldObject.updated_at]);
  assert.equal((await publicImage(oldPath)).bucket,'users');
  assert.equal((await publicImage(oldPath)).object_path,newPath,'Old aliases must resolve current bytes, not the rollback copy');
  assert.equal((await publicImage(newPath)).object_path,newPath);
  await actor('anon'); assert.equal((await sql('SELECT * FROM storage.objects')).length,0,'Retired originals do not inherit a broad legacy read policy');
  await actor('authenticated',owner); assert.equal((await sql('SELECT * FROM storage.objects WHERE id=$1',[oldObject.id])).length,0);
  await root(); await sql("UPDATE photos SET visibility='private' WHERE id=$1",[photo]);
  assert.equal(await publicImage(oldPath),null); assert.equal(await publicImage(newPath),null);
  assert.equal(await resolve(oldPath),null);
  await root(); await sql("INSERT INTO media_shares VALUES('photo',$1,NULL,$2)",[photo,group]);
  assert.equal((await resolve(oldPath)).object_path,newPath);
  assert.equal(await resolve(oldPath,outsider,session),null,'Session cannot be transferred to another actor');
  await root(); await sql('DELETE FROM messenger_members WHERE user_id=$1',[member]);
  assert.equal(await resolve(oldPath),null,'Membership revocation is checked for saved aliases');
  await root(); await sql('INSERT INTO messenger_members VALUES($1,$2)',[group,member]);
  await sql("INSERT INTO image_access_grants(token_hash,object_path,user_id,session_id) VALUES(repeat('b',64),$1,$2,$3)",[oldPath,member,session]);
  await service(); assert.equal((await sql("SELECT check_shared_image(repeat('b',64)) value"))[0].value.object_path,newPath);
  await root(); await sql('DELETE FROM auth.sessions WHERE id=$1',[session]);
  await service(); assert.equal((await sql("SELECT check_shared_image(repeat('b',64)) value"))[0].value,null);
  console.log('PASS old/new image paths use current visibility, current group membership and current verified session; saved grants never overwrite the new path');
  await service();
  assert.equal((await sql('SELECT * FROM photo_deletion_objects($1,$2)',[photo,outsider])).length,0);
  const cleanup = await sql('SELECT * FROM photo_deletion_objects($1,$2)',[photo,owner]);
  assert.deepEqual(new Set(cleanup.map(row=>row.name)),new Set([oldPath,newPath]));
  await actor('authenticated',owner);await assert.rejects(sql('SELECT * FROM photo_deletion_objects($1,$2)',[photo,owner]),/permission denied/);
  await root();await sql('DELETE FROM photos WHERE id=$1',[photo]);
  assert.equal(await publicImage(oldPath),null,'Deleting metadata never revives retained bytes');
  await actor('anon');assert.equal((await sql('SELECT * FROM storage.objects')).length,0);
  console.log('PASS confirmed server cleanup resolves only owned active/retained photo objects; deletion leaves retirement protection intact');
  await root();const publicId=randomUUID(),filePath=owner+'/folder/a.txt',physical=owner+'/files/folder/a.txt';
  const [file]=await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('users',$1) RETURNING *",[physical]);
  await sql("INSERT INTO user_file_metadata VALUES($1,$2,false,$3,$4,'users')",[owner,filePath,file.id,publicId]);
  await service();const fileSource=(await sql('SELECT get_file_preview_source($1) value',[filePath]))[0].value;
  assert.equal(fileSource.bucket,'users');assert.equal(fileSource.path,physical);assert.equal(fileSource.id,file.id);
  assert.equal((await sql('SELECT get_file_preview_source($1) value',[owner+'/folder/unknown.txt']))[0].value,null);
  assert.equal((await sql('SELECT get_preview_source_by_id($1) value',[file.id]))[0].value.path,physical);
  await root();await sql('DELETE FROM user_file_metadata WHERE source_id=$1',[file.id]);
  await service();assert.equal((await sql('SELECT get_preview_source_by_id($1) value',[file.id]))[0].value,null);
  await root();const [legacyFile]=await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('user-files',$1) RETURNING *",[filePath]);
  await sql("INSERT INTO user_file_metadata VALUES($1,$2,false,NULL,$3,'user-files')",[owner,filePath,publicId]);
  await service();assert.equal((await sql('SELECT get_file_preview_source($1) value',[filePath]))[0].value.id,legacyFile.id);
  assert.equal((await sql('SELECT get_preview_source_by_id($1) value',[legacyFile.id]))[0].value.path,filePath);
  console.log('PASS file preview sources use the actual metadata-bound object; unpublished and unbound copies never become preview sources');
} finally { await db.close(); }
