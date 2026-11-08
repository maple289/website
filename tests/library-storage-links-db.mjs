import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setupFileStorageFixture } from './file-storage-fixture.mjs';
const db=new PGlite(),owner=randomUUID(),viewer=randomUUID(),sid=randomUUID(),otherSid=randomUUID();
const sql=async(text,args)=>(await db.query(text,args)).rows;
const resolve=async(bucket,key,user=null,session=null)=>(await sql('SELECT resolve_library_storage_link($1,$2,$3,$4) value',[bucket,key,user,session]))[0].value;
const check=async hash=>(await sql('SELECT check_library_storage_link($1) value',[hash]))[0].value;
try {
 await setupFileStorageFixture(db);
 await db.exec('ALTER TABLE auth.sessions ADD PRIMARY KEY(id)');
 const sharing=await readFile('supabase/migrations/20260924000000_add_file_sharing.sql','utf8');
 await db.exec(sharing.match(/CREATE FUNCTION public\.can_read_user_file[\s\S]*?\$\$;/)[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
 const publicFiles=await readFile('supabase/migrations/20260924010000_add_public_files.sql','utf8');
 for(const name of ['user_file_ancestor_paths','public_file_root','resolve_public_user_file'])
  await db.exec(publicFiles.match(new RegExp('CREATE FUNCTION public\\.'+name+'[\\s\\S]*?\\$\\$;'))[0]);
 await db.exec(`CREATE TABLE fixture_media_shares(resource_id uuid,user_id uuid);
 CREATE OR REPLACE FUNCTION media_access_for_user(kind text,resource uuid,actor uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM public.videos WHERE kind='video' AND id=resource AND owner_id=actor)
 OR EXISTS(SELECT 1 FROM public.photos WHERE kind='photo' AND id=resource AND owner_id=actor)
 OR EXISTS(SELECT 1 FROM public.fixture_media_shares WHERE resource_id=resource AND user_id=actor)$$;`);
 await db.exec(await readFile('supabase/migrations/20261108090000_revocable_library_storage_links.sql','utf8'));
 for(const user of [owner,viewer]){await sql('INSERT INTO auth.users VALUES($1)',[user]);await sql("INSERT INTO profiles VALUES($1,'fixture@test.invalid')",[user]);}
 await sql('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2),($3,$4)',[sid,owner,otherSid,viewer]);
 const photo=randomUUID(),oldPath=owner+'/photos/'+photo+'/photo.jpg',newPath=owner+'/photos/'+photo+'/photo.jpg';
 const old=(await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('user-images',$1) RETURNING *",[oldPath]))[0];
 const copy=(await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('users',$1) RETURNING *",[newPath]))[0];
 await sql("INSERT INTO photos(id,owner_id,visibility,storage_path,storage_bucket,file_name,mime_type) VALUES($1,$2,'public',$3,'users','Photo.jpg','image/jpeg')",[photo,owner,newPath]);
 await sql(`INSERT INTO streamly_internal.storage_migration_objects(old_object_id,owner_id,resource_type,resource_id,media_role,old_bucket,old_key,old_version,
 new_object_id,new_bucket,new_key,new_version,bytes,sha256,verified_at,retired_at,old_created_at,old_updated_at)
 VALUES($1,$2,'photo',$3,'original','user-images',$4,$5,$6,'users',$7,$8,12,$9,now(),now(),$10,$11)`,
 [old.id,owner,photo,oldPath,old.version,copy.id,newPath,copy.version,'a'.repeat(64),old.created_at,old.updated_at]);
 assert.equal((await resolve('user-images',oldPath)).bucket,'users');
 assert.equal((await resolve('users',newPath)).resource_id,photo);
 assert.equal(await resolve('user-images','unknown'),null);
 await sql("UPDATE photos SET visibility='private' WHERE id=$1",[photo]);
 assert.equal(await resolve('user-images',oldPath),null);
 assert.ok(await resolve('users',newPath,owner,sid));assert.equal(await resolve('users',newPath,viewer,otherSid),null);
 await sql('INSERT INTO fixture_media_shares VALUES($1,$2)',[photo,viewer]);
 assert.ok(await resolve('user-images',oldPath,viewer,otherSid));
 const hash='a'.repeat(64);
 await sql("INSERT INTO library_storage_link_grants(token_hash,resource_type,resource_id,media_role,user_id,session_id,expires_at) VALUES($1,'photo',$2,'original',$3,$4,now()+interval '10 minutes')",[hash,photo,viewer,otherSid]);
 assert.ok(await check(hash));await sql('DELETE FROM fixture_media_shares WHERE resource_id=$1',[photo]);assert.equal(await check(hash),null);
 await sql('INSERT INTO fixture_media_shares VALUES($1,$2)',[photo,viewer]);
 await sql("UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1",[otherSid]);assert.equal(await check(hash),null);
 await sql('UPDATE auth.sessions SET not_after=NULL WHERE id=$1',[otherSid]);assert.ok(await check(hash));
 await db.exec('UPDATE streamly_internal.library_storage_control SET layout_version=2');
 const physical=owner+'/files/Folder/Original.docx',source=(await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('users',$1) RETURNING *",[physical]))[0];
 const meta=(await sql('SELECT * FROM user_file_metadata WHERE source_id=$1',[source.id]))[0];
 assert.equal(await resolve('users',physical),null);assert.ok(await resolve('users',physical,owner,sid));
 await sql('INSERT INTO user_file_shares VALUES($1,$2,$3)',[owner,meta.object_path,viewer]);assert.ok(await resolve('users',physical,viewer,otherSid));
 const fileHash='b'.repeat(64);
 await sql("INSERT INTO library_storage_link_grants(token_hash,resource_type,resource_id,media_role,user_id,session_id,expires_at) VALUES($1,'file',$2,'file',$3,$4,now()+interval '10 minutes')",[fileHash,meta.public_id,viewer,otherSid]);
 const moved=owner+'/files/Folder/Renamed.docx';await sql('UPDATE storage.objects SET name=$2 WHERE id=$1',[source.id,moved]);
 assert.equal((await check(fileHash)).object_path,moved,'Saved file capabilities follow stable public identity after an authorized move');
 await sql('DELETE FROM user_file_shares WHERE owner_id=$1',[owner]);assert.equal(await check(fileHash),null);
 await sql('INSERT INTO user_file_shares VALUES($1,$2,NULL)',[owner,owner+'/Folder/Renamed.docx']);
 assert.ok((await resolve('users',moved)).public);
 await sql('UPDATE user_file_metadata SET trashed_at=now() WHERE source_id=$1',[source.id]);assert.equal(await resolve('users',moved),null);
 await sql('DELETE FROM photos WHERE id=$1',[photo]);assert.equal(await resolve('user-images',oldPath,owner,sid),null,'Retained bytes cannot revive a deleted resource');
 await db.exec('SET ROLE authenticated');
 for(const statement of ["SELECT * FROM library_storage_link_grants","SELECT check_library_storage_link('unknown')","SELECT resolve_library_storage_link('users','unknown')"])
  await assert.rejects(sql(statement),/permission denied/);
 console.log('PASS storage links resolve current public/private resources and legacy aliases; sharing/session revocation, stable file moves, Trash/deletion and privileged RPC denial remain enforced');
}catch(error){console.error(error.message,error.where,error.query,error.params);process.exitCode=1;}finally{await db.close();}
