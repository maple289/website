// Real publication/cleanup SQL in an isolated database. No user media is touched.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite(), owner='11111111-1111-4111-8111-111111111111';
const sql=async(text,args)=>(await db.query(text,args)).rows;
const migration=async(name)=>db.exec(await readFile('supabase/migrations/'+name,'utf8'));
const root=()=>db.exec('RESET ROLE');
const publish=async(job,record=job.record,claim=job.claim)=>{
 await root();await db.exec('SET ROLE service_role');
 return sql('SELECT publish_media_upload($1,$2,$3) result',[job.id,claim,record]);
};
const prepare=async({legacy=false}={})=>{
 await root();const id=randomUUID(),claim=randomUUID(),base=owner+'/videos/'+id;
 const record={id,owner_id:owner,file_name:'Original.mov',visibility:'private',file_size:100,mime_type:'video/mp4',
  storage_path:legacy?base+'/original.mov':base+'/video.mp4',processed_storage_path:legacy?base+'/stream.mp4':base+'/video.mp4',
  preview_path:owner+'/video-previews/'+id+'/preview.webp',processing_status:'ready',
  container_format:'mp4',video_codec:'h264',duration_seconds:2,processed_file_size:10,
  source_metadata:{container:'mov',source_bytes:100},processing_action:'transcoded'};
 await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('media-staging',$1,'{\"size\":100}')",[owner+'/'+id+'/source']);
 await sql("SELECT queue_media_upload($1,$2,'video',$3,'private',false,NULL)",[id,owner,record.file_name]);
 await sql("UPDATE media_upload_jobs SET status='processing',claim_token=$2,started_at=now() WHERE id=$1",[id,claim]);
 for(const [bucket,path] of [["user-videos",record.processed_storage_path],['user-images',record.preview_path],...(legacy?[["user-videos",record.storage_path]]:[])]){
  const prefix=bucket==='user-videos'?'configured/videos/':'configured/images/';
  await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,'{\"size\":10}')",[bucket,prefix+path]);
 }
 return {id,claim,record};
};
try{
 await db.exec(await readFile('tests/media-upload-setup.sql','utf8'));
 await db.exec(`ALTER TABLE storage.objects ADD COLUMN metadata jsonb,
 ADD COLUMN version text DEFAULT gen_random_uuid()::text,ADD COLUMN updated_at timestamptz DEFAULT now();
 CREATE TABLE video_deletions(id uuid PRIMARY KEY);
 CREATE TABLE storage_settings(id int PRIMARY KEY,videos_base_path text,images_base_path text);
 INSERT INTO storage_settings VALUES(1,'configured/videos','configured/images');
 ALTER TABLE videos ADD COLUMN owner_email text,ADD COLUMN file_size bigint,ADD COLUMN mime_type text,ADD COLUMN processed_storage_path text,
 ADD COLUMN container_format text,ADD COLUMN video_codec text,ADD COLUMN video_bitrate bigint,ADD COLUMN frame_rate numeric,ADD COLUMN source_metadata jsonb,
 ADD COLUMN processing_action text,ADD COLUMN audio_codec text,ADD COLUMN audio_bitrate bigint,ADD COLUMN processed_file_size bigint,
 ADD COLUMN resolution_width int,ADD COLUMN resolution_height int,ADD COLUMN duration_seconds numeric;
 ALTER TABLE photos ADD COLUMN owner_email text,ADD COLUMN file_size bigint,ADD COLUMN mime_type text,ADD COLUMN preview_path text,
 ADD COLUMN thumbnail_path text,ADD COLUMN width int,ADD COLUMN height int;`);
 await migration('20260928090000_validated_media_uploads.sql');
 await migration('20261003140000_media_job_integrity.sql');
 await migration('20261107010000_single_final_video_publication.sql');
 const single=await prepare();await publish(single);await publish(single);
 await root();
 const [video]=await sql('SELECT storage_path,processed_storage_path,source_metadata,mime_type FROM videos WHERE id=$1',[single.id]);
 assert.equal(video.storage_path,video.processed_storage_path);assert.equal(video.mime_type,'video/mp4');
 assert.deepEqual(video.source_metadata,single.record.source_metadata);
 assert.equal((await sql("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='user-videos' AND starts_with(name,$1)",['configured/videos/'+owner+'/videos/'+single.id+'/']))[0].n,1);
 assert.equal((await sql('SELECT status FROM media_upload_jobs WHERE id=$1',[single.id]))[0].status,'complete');
 console.log('PASS one verified final object publishes Ready idempotently; original probe metadata is retained');
 const old=await prepare({legacy:true});await publish(old);
 console.log('PASS legacy worker original/stream publication remains compatible for a controlled worker upgrade');
 const pending=await prepare();
 for(const patch of [{processed_storage_path:null},{storage_path:owner+'/videos/'+pending.id+'/other.mp4'},
  {storage_path:owner+'/videos/'+pending.id+'/original.mov'},{owner_id:randomUUID()},
  {mime_type:'video/quicktime'},{container_format:'mov'},{duration_seconds:null},{duration_seconds:0},
  {video_codec:'vp9'},{processed_file_size:11}]){
  await assert.rejects(publish(pending,{...pending.record,...patch}));
  await root();assert.equal((await sql('SELECT status FROM media_upload_jobs WHERE id=$1',[pending.id]))[0].status,'processing');
 }
 await assert.rejects(publish(pending,pending.record,randomUUID()),/claim expired/);
 await root();await sql("DELETE FROM storage.objects WHERE bucket_id='user-images' AND name=$1",['configured/images/'+pending.record.preview_path]);
 await assert.rejects(publish(pending),/missing/);
 console.log('PASS mismatched identity/path, missing thumbnail, stale claim and unverified/size-mismatched final metadata cannot publish');
 await root();
 const candidates=async()=>sql('SELECT * FROM finalized_video_source_cleanup_candidates()');
 assert.equal((await candidates()).length,0,'No immediate cleanup race with final publication');
 await sql("UPDATE media_upload_jobs SET finished_at=now()-interval '20 minutes' WHERE id=ANY($1::uuid[])",[[single.id,old.id]]);
 const expected=[{bucket_id:'media-staging',name:owner+'/'+single.id+'/source'}];
 assert.deepEqual(await candidates(),expected,'Legacy originals are never swept by the new cleanup queue');
 const held=randomUUID();await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('media-staging',$1,'{\"size\":10}')",[owner+'/'+held+'/source']);
 await sql("SELECT queue_media_upload($1,$2,'video','Drain fixture','private',false,NULL)",[held,owner]);
 await db.exec('UPDATE streamly_internal.library_storage_control SET pause_media_claims=true');
 assert.equal((await sql('SELECT * FROM claim_media_uploads(2)')).length,0);assert.deepEqual(await candidates(),[]);
 assert.equal((await sql('SELECT status FROM media_upload_jobs WHERE id=$1',[held]))[0].status,'queued');
 await db.exec('UPDATE streamly_internal.library_storage_control SET pause_media_claims=false');
 assert.equal((await sql('SELECT * FROM claim_media_uploads(2)')).length,1);
 console.log('PASS operator drain pauses claims and cleanup without cancelling uploads; queued work resumes');
 await db.exec('BEGIN');await sql("UPDATE storage.objects SET version=gen_random_uuid()::text WHERE bucket_id='user-videos' AND name=$1",['configured/videos/'+single.record.storage_path]);assert.deepEqual(await candidates(),[]);await db.exec('ROLLBACK');
 for(const mutation of ["processing_status='error'","duration_seconds=0","duration_seconds='NaN'::numeric","processed_file_size=11","mime_type='video/quicktime'"]){
  await db.exec('BEGIN');await sql('UPDATE videos SET '+mutation+' WHERE id=$1',[single.id]);assert.deepEqual(await candidates(),[]);await db.exec('ROLLBACK');
 }
 await sql('INSERT INTO video_deletions VALUES($1)',[single.id]);assert.deepEqual(await candidates(),[]);await sql('DELETE FROM video_deletions WHERE id=$1',[single.id]);
 await sql("UPDATE media_upload_jobs SET status='error' WHERE id=$1",[single.id]);assert.deepEqual(await candidates(),[]);
 await sql("UPDATE media_upload_jobs SET status='complete' WHERE id=$1",[single.id]);
 await sql("DELETE FROM storage.objects WHERE bucket_id='user-videos' AND name=$1",['configured/videos/'+single.record.storage_path]);assert.deepEqual(await candidates(),[]);
 console.log('PASS cleanup retains failed/nonready/nonfinite/deleting/missing-final sources and never targets permanent media');
 for(const role of ['anon','authenticated']){
  await root();await db.exec('SET ROLE '+role);
  await assert.rejects(sql('SELECT finalized_video_source_cleanup_candidates()'),/permission denied/);
  await assert.rejects(sql('SELECT publish_media_upload($1,$2,$3)',[single.id,single.claim,single.record]),/permission denied/);
  await assert.rejects(sql('UPDATE streamly_internal.library_storage_control SET pause_media_claims=false'),/permission denied/);
 }
 console.log('PASS anonymous/browser roles cannot call privileged publication or cleanup RPCs');
}finally{await db.close();}
