// Execute real preview queue/invalidation/cleanup SQL in isolated PostgreSQL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setupFileStorageFixture } from './file-storage-fixture.mjs';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111';
const sql=async(text,args)=>(await db.query(text,args)).rows;
const apply=async name=>{
 const body=await readFile('supabase/migrations/'+name,'utf8');
 try {await db.exec(body);}catch(e){throw Error(name+': '+e.message+' '+e.where+' '+e.position);}
};
const root=()=>db.exec('RESET ROLE');
const service=()=>db.exec('SET ROLE service_role');
const object=async(bucket,name)=> (await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,'{\"size\":12,\"mimetype\":\"application/octet-stream\"}') RETURNING *",[bucket,name]))[0];
const queue=async source=>(await sql("SELECT queue_file_preview($1,coalesce(version,'')||':'||updated_at::text,'docx') job FROM storage.objects WHERE id=$1",[source.id]))[0].job;
try {
 await setupFileStorageFixture(db);
 await db.exec(`INSERT INTO auth.users VALUES('${owner}');INSERT INTO profiles VALUES('${owner}','fixture@test.invalid');
 CREATE TABLE messenger_messages(id uuid PRIMARY KEY,deletion_started_at timestamptz);
 CREATE TABLE messenger_members(conversation_id uuid,user_id uuid,joined_at timestamptz);
 CREATE TABLE messenger_attachments(id uuid,name text,conversation_id uuid,source_id uuid,object_path text,uploader_id uuid,message_id uuid);
 CREATE FUNCTION messenger_active(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION messenger_member(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;`);
 await apply('20261001000000_add_file_previews.sql');
 await apply('20261002000000_preserve_excel_preview_layout.sql');
 await db.exec('DROP FUNCTION get_preview_source_by_id(uuid)');
 await apply('20261008020000_messenger_previews.sql');
 // These location resolvers supersede the legacy preview migration in production.
 const locations=await readFile('supabase/migrations/20261108010000_storage_location_compatibility.sql','utf8');
 for(const name of ['get_file_preview_source','get_preview_source_by_id'])
   await db.exec(locations.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'[\\s\\S]*?\\$\\$;'))[0]);
 await apply('20261108080000_library_preview_cache_locations.sql');
 const old=await object('user-files',owner+'/ready.docx');await service();let job=await queue(old);
 assert.equal(job.cache_bucket,'file-previews');assert.equal(job.preview_path,job.id+'.pdf');
 await sql("UPDATE file_preview_jobs SET status='ready' WHERE id=$1",[job.id]);
 await root();await db.exec('UPDATE streamly_internal.library_storage_control SET layout_version=2');
 const modern=await object('users',owner+'/files/current.docx');
 await service();const fresh=await queue(modern);
 assert.equal(fresh.cache_bucket,'cache');assert.equal(fresh.preview_path,`previews/${owner}/${modern.id}/${fresh.id}.pdf`);
 await assert.rejects(object('cache',fresh.preview_path),/active job/,'Queued cache uploads cannot bypass a claim');
 const claimed=await sql('SELECT * FROM claim_file_preview()');assert.equal(claimed[0].id,fresh.id);
 const pdf=await object('cache',fresh.preview_path);assert.ok(pdf.id);
 await sql("UPDATE file_preview_jobs SET status='ready' WHERE id=$1",[fresh.id]);
 await assert.rejects(object('cache','previews/unknown.pdf'),/active job/);
 await root();await db.exec('UPDATE streamly_internal.library_storage_control SET pause_media_claims=true,pause_library_writes=true');
 await service();assert.equal((await queue(modern)).id,fresh.id,'Ready previews are reused during drain without conversion');
 await root();const pending=await object('users',owner+'/files/pending.docx');
 await service();await assert.rejects(queue(pending),/maintenance/);
 await assert.rejects(sql('DELETE FROM file_preview_jobs WHERE id=$1',[fresh.id]),/maintenance/);
 await root();await db.exec('UPDATE streamly_internal.library_storage_control SET pause_library_writes=false,pause_media_claims=false');
 await service();const waiting=await queue(pending);
 await root();const conversation=randomUUID(),message=randomUUID();
 const attachment=await object('messenger-attachments','attachments/sample.docx');
 await sql('INSERT INTO messenger_messages(id) VALUES($1)',[message]);
 await sql('INSERT INTO messenger_attachments(id,conversation_id,source_id,object_path,uploader_id,message_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),conversation,attachment.id,attachment.name,owner,message]);
 await db.exec('UPDATE streamly_internal.library_storage_control SET pause_media_claims=true,pause_library_writes=true');
 await service();const messenger=await queue(attachment);
 assert.equal(messenger.cache_bucket,'file-previews');assert.equal(messenger.preview_path,messenger.id+'.pdf');
 assert.equal((await sql('SELECT * FROM claim_file_preview()'))[0].id,messenger.id,'Library drain does not claim waiting library jobs or stop Messenger');
 await sql("UPDATE file_preview_jobs SET status='ready' WHERE id=$1",[messenger.id]);
 await sql('INSERT INTO file_preview_cleanup(path) VALUES($1)',[messenger.preview_path]);
 await sql("INSERT INTO file_preview_cleanup(path) VALUES('unscoped-legacy-orphan.pdf')");
 await sql('DELETE FROM file_preview_jobs WHERE id=$1',[messenger.id]);
 assert.equal((await sql('SELECT * FROM file_preview_cleanup_candidates()')).length,1,'Only known Messenger cleanup runs while library is paused');
 await root();await db.exec('UPDATE streamly_internal.library_storage_control SET pause_preview_claims=true');
 await service();assert.equal((await sql('SELECT * FROM claim_file_preview()')).length,0);
 await root();await db.exec('UPDATE streamly_internal.library_storage_control SET pause_preview_claims=false,pause_library_writes=false,pause_media_claims=false');
 await service();assert.equal((await sql('SELECT * FROM claim_file_preview()'))[0].id,waiting.id);
 await sql('DELETE FROM storage.objects WHERE id=$1',[pending.id]);
 await assert.rejects(object('cache',waiting.preview_path),/active job/,'Late upload after job/source deletion is blocked');
 assert.ok((await sql('SELECT * FROM file_preview_cleanup_candidates()')).some(c=>c.path===waiting.preview_path&&c.cache_bucket==='cache'));
 await root();
 const intent=randomUUID(),newSource=await object('users',owner+'/files/copied.docx');
 const oldCache=await object('file-previews',job.preview_path);
 const copyPath=`previews/${owner}/${newSource.id}/${job.id}.pdf`;
 await sql(`INSERT INTO streamly_internal.prepared_preview_copies(job_id,owner_id,old_source_id,old_source_version,old_cache_bucket,old_cache_key,old_cache_object_id,old_cache_version,new_source_id,new_cache_key,bytes,sha256)
 VALUES($1,$2,$3,$4,'file-previews',$5,$6,$7,$8,$9,12,$10)`,[job.id,owner,old.id,job.source_version,job.preview_path,oldCache.id,oldCache.version,newSource.id,copyPath,'a'.repeat(64)]);
 await service();const copied=await object('cache',copyPath);
 await assert.rejects(sql('INSERT INTO streamly_internal.prepared_preview_copies(job_id) VALUES($1)',[intent]),/permission denied/);
 await root();await sql("UPDATE streamly_internal.prepared_preview_copies SET new_cache_object_id=$2,new_cache_version=$3,verified_at=now() WHERE job_id=$1",[job.id,copied.id,copied.version]);
 await sql("UPDATE file_preview_jobs SET source_id=$2,object_path=$3,source_version=$4,source_bucket='users',cache_bucket='cache',preview_path=$5 WHERE id=$1",[job.id,newSource.id,newSource.name,newSource.version+':'+(await sql('SELECT updated_at::text value FROM storage.objects WHERE id=$1',[newSource.id]))[0].value,copyPath]);
 await service();assert.equal((await queue(newSource)).id,job.id,'Verified ready job follows new source without regeneration');
 await sql('UPDATE storage.objects SET version=$2 WHERE id=$1',[newSource.id,randomUUID()]);
 assert.equal((await sql('SELECT id FROM file_preview_jobs WHERE id=$1',[job.id])).length,0);
 await root();await db.exec('SET ROLE authenticated');await assert.rejects(sql('SELECT * FROM file_preview_cleanup_candidates()'),/permission denied/);
 console.log('PASS preview cache layout, ready reuse, library drain, Messenger independence, scoped cleanup, late-upload rejection, prepared copy and source invalidation');
} catch(error) {console.error(error.message,error.where,error.query,error.params);process.exitCode=1;} finally {await db.close();}
