// Isolated PostgreSQL: actual settings and public-preview migrations, no live writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();const owner='11111111-1111-4111-8111-111111111111';let checks=0;
const query=async(text,values)=>(await db.query(text,values)).rows;
const actor=async(role,id='')=>db.exec(`RESET ROLE; SET ROLE ${role}; SET request.jwt.claim.sub='${id}';`);
const pass=label=>{checks++;console.log('PASS '+label);};
try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;CREATE SCHEMA storage;GRANT USAGE ON SCHEMA auth,storage TO anon,authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE TABLE public.photos(visibility text,owner_id uuid,storage_path text,preview_path text,thumbnail_path text);
    CREATE TABLE public.videos(visibility text,owner_id uuid,preview_path text);
    CREATE TABLE storage.objects(bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON storage.objects TO anon,authenticated;
    CREATE POLICY user_images_read_own ON storage.objects FOR SELECT TO authenticated USING(bucket_id='user-images' AND starts_with(name,auth.uid()::text||'/'));
    CREATE POLICY user_images_read_public ON storage.objects FOR SELECT TO anon,authenticated USING(bucket_id='user-images' AND EXISTS(SELECT 1 FROM public.photos p WHERE p.visibility='public' AND name=p.preview_path));
    GRANT SELECT ON public.photos,public.videos TO anon,authenticated;
    INSERT INTO public.photos VALUES('public','${owner}','${owner}/photos/public/original.jpg','${owner}/photos/public/preview.webp','${owner}/photos/public/thumbnail.webp'),
      ('private','${owner}','${owner}/photos/private/original.jpg','${owner}/photos/private/preview.webp','${owner}/photos/private/thumbnail.webp');
    INSERT INTO public.videos VALUES('public','${owner}','${owner}/video-previews/public.webp'),('private','${owner}','${owner}/video-previews/private.webp');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260907170638_add_storage_settings_table.sql',import.meta.url),'utf8'));
  await actor('anon');await assert.rejects(query("SELECT public.get_storage_base_path('images')"),/permission denied/);
  await db.exec('RESET ROLE');await db.exec(await readFile(new URL('../supabase/migrations/20261013010000_public_media_preview_access.sql',import.meta.url),'utf8'));
  await actor('anon');assert.equal((await query("SELECT public.get_storage_base_path('images') value"))[0].value,'');
  assert.equal((await query("SELECT public.get_storage_base_path('videos') value"))[0].value,'');
  assert.equal((await query("SELECT public.get_storage_base_path('unknown') value"))[0].value,'');
  await assert.rejects(query('SELECT * FROM storage_settings'),/permission denied/);
  pass('anonymous path lookup succeeds without exposing admin settings/table');
  await db.exec('RESET ROLE');await db.exec(`INSERT INTO storage.objects SELECT 'user-images',p FROM (
    SELECT storage_path p FROM photos UNION SELECT preview_path FROM photos UNION SELECT thumbnail_path FROM photos UNION SELECT preview_path FROM videos) x;
    INSERT INTO storage.objects VALUES('user-images','${owner}/photos/uncommitted/preview.webp'),('messenger-attachments','${owner}/photos/public/preview.webp'),('file-previews','${owner}/photos/public/preview.webp');`);
  await actor('anon');const publicRows=await query('SELECT * FROM storage.objects');assert.equal(publicRows.length,4);
  assert.ok(publicRows.every(x=>x.name.includes('/public/')||x.name.endsWith('/public.webp')));
  pass('public photo original/preview/thumbnail and video poster readable; private/staging/other buckets denied');
  await actor('authenticated',owner);assert.equal((await query('SELECT * FROM storage.objects')).length,9);
  pass('existing authenticated owner policy remains intact');
  await db.exec('RESET ROLE');await db.exec("UPDATE storage_settings SET images_base_path='/media/nested/images/' WHERE id=1; UPDATE storage.objects SET name='media/nested/images/'||name WHERE bucket_id='user-images';");
  await actor('anon');assert.equal((await query('SELECT * FROM storage.objects')).length,4);
  assert.equal((await query('SELECT public.can_read_public_image($1) yes',[owner+'/photos/public/preview.webp']))[0].yes,false);
  assert.equal((await query('SELECT public.can_read_public_image($1) yes',['evil/media/nested/images/'+owner+'/photos/public/preview.webp']))[0].yes,false);
  pass('multi-segment configured prefix uses exact keys, never suffix/bucket-wide matching');
  await db.exec('RESET ROLE');await db.exec("UPDATE photos SET visibility='private' WHERE visibility='public'; UPDATE videos SET visibility='private' WHERE visibility='public';");
  await actor('anon');assert.equal((await query('SELECT * FROM storage.objects')).length,0);
  pass('public visibility revocation immediately removes new anonymous reads');
  console.log(`${checks} public preview database checks passed.`);
}finally{await db.close();}
