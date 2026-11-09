// Real queue/reservation policies in isolated PostgreSQL; no uploads or live DB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const sql=async(text,args)=>(await db.query(text,args)).rows;
const root=()=>db.exec('RESET ROLE');
const actor=async(id=owner,role='authenticated')=>db.exec(`RESET ROLE;SET ROLE ${role};SET request.jwt.claim.sub='${id}'`);
const migration=async name=>{
 const contents=await readFile('supabase/migrations/'+name,'utf8');
 try{return await db.exec(contents);}catch(error){
  const position=Number(error.position||error.internalPosition||contents.length);
  throw Error(name+': '+error.message+' at '+position+' '+(error.where||'')+'\n'+contents.slice(Math.max(0,position-180),position+120));
 }
};
const reserve=async(id,kind='video',video=null)=>(await sql('SELECT reserve_media_upload($1,$2,$3) value',[id,kind,video]))[0].value;
const queue=async(id,kind='video',video=null,preview=false)=>{
 await actor(owner,'service_role');
 return sql("SELECT queue_media_upload($1,$2,$3,'Fixture','private',$4,$5)",[id,owner,kind,preview,video]);
};
const upload=async(bucket,path)=>sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,'{\"size\":10}')",[bucket,path]);
try {
 await db.exec(await readFile('tests/media-upload-setup.sql','utf8'));
 await db.exec(`ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz,ADD COLUMN banned_until timestamptz;
   ALTER TABLE storage.objects ADD COLUMN metadata jsonb,ADD COLUMN version text DEFAULT gen_random_uuid()::text,ADD COLUMN updated_at timestamptz DEFAULT now();
   CREATE TABLE video_deletions(id uuid PRIMARY KEY,owner_id uuid);
   CREATE TABLE storage_settings(id int PRIMARY KEY,videos_base_path text,images_base_path text);
   INSERT INTO storage_settings VALUES(1,'configured/videos','configured/images');
   CREATE TABLE auth.sessions(id uuid,user_id uuid,not_after timestamptz);
   CREATE TABLE user_file_metadata(owner_id uuid,object_path text,is_folder boolean,source_id uuid,public_id uuid);
   CREATE TABLE image_access_grants(token_hash text,object_path text,user_id uuid,session_id uuid,expires_at timestamptz);
   CREATE FUNCTION media_access_for_user(text,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
   CREATE FUNCTION can_read_user_file(text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`);
 const account=(await readFile('supabase/migrations/20261012010000_account_security_boundaries.sql','utf8')).match(/CREATE FUNCTION public\.active_account[\s\S]*?\$\$;/)[0];
 await db.exec(account);
 await migration('20260928090000_validated_media_uploads.sql');
 await migration('20261003140000_media_job_integrity.sql');
 // This migration's publisher needs the real video metadata shape even though
 // these tests only queue. SQL bodies are compiled against the same columns.
 await db.exec(`ALTER TABLE videos ADD COLUMN owner_email text,ADD COLUMN file_size bigint,ADD COLUMN mime_type text,ADD COLUMN processed_storage_path text,
   ADD COLUMN container_format text,ADD COLUMN video_codec text,ADD COLUMN video_bitrate bigint,ADD COLUMN frame_rate numeric,ADD COLUMN source_metadata jsonb,
   ADD COLUMN processing_action text,ADD COLUMN audio_codec text,ADD COLUMN audio_bitrate bigint,ADD COLUMN processed_file_size bigint,
   ADD COLUMN resolution_width int,ADD COLUMN resolution_height int,ADD COLUMN duration_seconds numeric;
   ALTER TABLE photos ADD COLUMN owner_email text,ADD COLUMN file_size bigint,ADD COLUMN mime_type text,ADD COLUMN preview_path text,
   ADD COLUMN thumbnail_path text,ADD COLUMN width int,ADD COLUMN height int;`);
 await migration('20261107010000_single_final_video_publication.sql');
 await migration('20261108010000_storage_location_compatibility.sql');
 const pathGuard=(await readFile('supabase/migrations/20261108020000_user_file_catalog_compatibility.sql','utf8')).match(/CREATE FUNCTION streamly_internal\.valid_file_path[\s\S]*?\$\$;/)[0];
 await db.exec(pathGuard);
 await migration('20261108040000_user_storage_authorization.sql');
 await migration('20261108060000_media_job_storage_locations.sql');
 await migration('20261108070000_user_media_publication.sql');
 await db.exec('DROP POLICY old_permissive ON storage.objects');
 await actor();const legacy=randomUUID(),old=await reserve(legacy);
 assert.deepEqual(old,{bucket:'media-staging',prefix:owner+'/'+legacy});
 await upload(old.bucket,old.prefix+'/source');await queue(legacy);
 await root();let job=(await sql('SELECT * FROM media_upload_jobs WHERE id=$1',[legacy]))[0];
 assert.equal(job.input_bucket,'media-staging');assert.equal(job.input_prefix,old.prefix);assert.equal(job.output_layout,1);
 await db.exec('UPDATE streamly_internal.library_storage_control SET layout_version=2');
 await actor();const modern=randomUUID(),current=await reserve(modern);
 assert.deepEqual(current,{bucket:'staging',prefix:'uploads/'+owner+'/'+modern});
 await assert.rejects(upload('staging','uploads/'+owner+'/'+randomUUID()+'/source'),/row-level security/);
 await upload(current.bucket,current.prefix+'/source');
 await assert.rejects(upload(current.bucket,current.prefix+'/extra'),/row-level security/);
 await actor(other);await assert.rejects(reserve(modern),/does not match/);
 await assert.rejects(upload(current.bucket,current.prefix+'/preview'),/row-level security/);
 await queue(modern);await root();job=(await sql('SELECT * FROM media_upload_jobs WHERE id=$1',[modern]))[0];
 assert.equal(job.input_bucket,'staging');assert.equal(job.input_prefix,current.prefix);assert.equal(job.output_layout,2);
 await actor();await assert.rejects(reserve(modern),/already queued/);
 await assert.rejects(upload(current.bucket,current.prefix+'/preview'),/row-level security/);
 assert.equal((await sql('DELETE FROM storage.objects WHERE name=$1 RETURNING id',[current.prefix+'/source'])).length,0,'Active processing inputs cannot be removed by client cleanup');
 await queue(modern);await actor(owner,'service_role');
 await assert.rejects(sql("SELECT queue_media_upload($1,$2,'photo','Fixture','private',false,NULL)",[modern,owner]),/different details/);
 console.log('PASS reservations bind verified owner/kind and immutable staging location; queued jobs capture output layout; unreserved/foreign/replacement writes and active-source deletion are denied');
 await actor();const olderClient=randomUUID();await upload('media-staging',owner+'/'+olderClient+'/source');await queue(olderClient);
 await root();job=(await sql('SELECT * FROM media_upload_jobs WHERE id=$1',[olderClient]))[0];
 assert.equal(job.input_bucket,'media-staging');assert.equal(job.output_layout,2,'Old clients still normalize into the active new output layout');
 await actor();await assert.rejects(upload('media-staging',owner+'/'+olderClient+'/preview'),/row-level security/);
 const target='33333333-3333-4333-8333-333333333333',poster=randomUUID();
 const posterInput=await reserve(poster,'preview',target);await upload(posterInput.bucket,posterInput.prefix+'/source');
 await queue(poster,'preview',target);await root();
 assert.equal((await sql('SELECT output_layout FROM media_upload_jobs WHERE id=$1',[poster]))[0].output_layout,1,'Preview output follows its target video bucket');
 await actor();const incomplete=randomUUID(),input=await reserve(incomplete);await upload(input.bucket,input.prefix+'/source');
 await assert.rejects(queue(incomplete,'video',null,true),/incomplete/);
 await root();await db.exec('UPDATE streamly_internal.library_storage_control SET pause_library_writes=true');
 await actor();await assert.rejects(reserve(randomUUID()),/maintenance/);
 await assert.rejects(upload(input.bucket,input.prefix+'/preview'),/maintenance/);
 await assert.rejects(queue(incomplete),/maintenance/);
 await root();await db.exec('UPDATE streamly_internal.library_storage_control SET pause_library_writes=false');
 await sql("UPDATE streamly_internal.media_upload_reservations SET lease_until=now()-interval '1 hour' WHERE id=$1",[incomplete]);
 await actor();await assert.rejects(upload(input.bucket,input.prefix+'/preview'),/row-level security/);
 await reserve(incomplete);await upload(input.bucket,input.prefix+'/preview');
 await actor(owner,'anon');await assert.rejects(reserve(randomUUID()),/permission denied/);
 await actor();await assert.rejects(sql("SELECT queue_media_upload($1,$2,'video','Fixture','private')",[incomplete,owner]),/permission denied/);
 console.log('PASS old-client inputs stay compatible, preview output follows its target, incomplete/paused requests fail, and expired leases renew without deleting any TUS state');

 const prepare=async(kind='video',target=null)=>{
   await actor();const id=randomUUID(),input=await reserve(id,kind,target);
   await upload(input.bucket,input.prefix+'/source');await queue(id,kind,target);
   await root();const claim=randomUUID();await sql("UPDATE media_upload_jobs SET status='processing',claim_token=$2,started_at=now() WHERE id=$1",[id,claim]);
   const base=owner+'/'+(kind==='photo'?'photos':'videos')+'/'+(target||id);
   const record=kind==='preview'?{path:base+'/'+id+'.webp',bucket:'users'}:{id,owner_id:owner,file_name:'Fixture',visibility:'private',file_size:10,
     storage_bucket:'users',storage_path:base+(kind==='video'?'/video.mp4':'/photo.jpg'),
     mime_type:kind==='video'?'video/mp4':'image/jpeg',preview_path:base+(kind==='video'?'/thumbnail.webp':'/preview.webp'),
     ...(kind==='video'?{preview_bucket:'users',processed_storage_path:base+'/video.mp4',processing_status:'ready',container_format:'mp4',video_codec:'h264',
       duration_seconds:2,processed_file_size:10,source_metadata:{container:'mov'},processing_action:'transcoded'}:{thumbnail_path:base+'/thumbnail.webp',width:64,height:48})};
   const paths=kind==='preview'?[record.path]:[record.storage_path,record.preview_path,...(kind==='photo'?[record.thumbnail_path]:[])];
   for(const path of paths)await upload('users',path);
   return {id,claim,record,input,paths};
 };
 const publish=async(job,record=job.record)=>{
   await actor(owner,'service_role');return (await sql('SELECT publish_media_upload($1,$2,$3) value',[job.id,job.claim,record]))[0].value;
 };
 const modernVideo=await prepare();const publication=await publish(modernVideo);
 assert.equal(publication.id,modernVideo.id);assert.equal(publication.final_object.bucket,'users');assert.equal(publication.final_object.path,modernVideo.record.storage_path);
 assert.deepEqual(await publish(modernVideo),publication,'Publication remains idempotent');
 await root();const [videoRow]=await sql('SELECT * FROM videos WHERE id=$1',[modernVideo.id]);
 assert.equal(videoRow.storage_bucket,'users');assert.equal(videoRow.preview_bucket,'users');assert.equal(videoRow.storage_path,videoRow.processed_storage_path);
 assert.deepEqual(videoRow.source_metadata,{container:'mov'});
 const modernPhoto=await prepare('photo');await publish(modernPhoto);
 await root();assert.equal((await sql('SELECT storage_bucket FROM photos WHERE id=$1',[modernPhoto.id]))[0].storage_bucket,'users');
 const replacement=await prepare('preview',modernVideo.id);assert.deepEqual(await publish(replacement),{path:replacement.record.path,bucket:'users'});
 await actor();
 assert.equal((await sql("DELETE FROM storage.objects WHERE bucket_id='users' AND name=$1 RETURNING id",[modernVideo.record.preview_path])).length,0,'A current thumbnail cannot be deleted as unused');
 await sql('UPDATE videos SET preview_path=$2 WHERE id=$1',[modernVideo.id,replacement.record.path]);
 assert.equal((await sql("DELETE FROM storage.objects WHERE bucket_id='users' AND name=$1 RETURNING id",[modernVideo.record.preview_path])).length,1,'Confirmed replacement can remove the original generated thumbnail');
 await actor(owner,'anon');assert.equal((await sql("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='users'")).map(row=>row.n)[0],0,'An anon role never inherits private owner access from a supplied sub');
 await root();await sql("UPDATE videos SET visibility='public' WHERE id=$1",[modernVideo.id]);
 await actor('','anon');assert.equal((await sql("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='users' AND starts_with(name,$1)",[owner+'/videos/'+modernVideo.id+'/']))[0].n,2);
 await root();await sql("UPDATE videos SET visibility='private' WHERE id=$1",[modernVideo.id]);
 await actor('','anon');assert.equal((await sql("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='users'")).map(row=>row.n)[0],0);
 console.log('PASS users-bucket video/photo/preview publication is atomic and idempotent, retains source metadata, authorizes public bytes by current visibility and cleans only unused owned thumbnails');

 const invalid=await prepare();
 for(const patch of [{storage_bucket:'user-videos'},{preview_bucket:'user-images'},
   {storage_path:owner+'/videos/'+invalid.id+'/original.mov'},{preview_path:owner+'/video-previews/'+invalid.id+'/preview.webp'},
   {owner_id:other},{processed_file_size:11},{container_format:'mov'},{duration_seconds:0},{video_codec:'vp9'}]){
   await assert.rejects(publish(invalid,{...invalid.record,...patch}));
 }
 await root();assert.equal((await sql('SELECT status FROM media_upload_jobs WHERE id=$1',[invalid.id]))[0].status,'processing');
 await sql("UPDATE media_upload_jobs SET status='error',finished_at=now()-interval '20 minutes' WHERE id=$1",[invalid.id]);
 await actor(owner,'service_role');const garbage=await sql('SELECT * FROM media_upload_cleanup_candidates()');
 assert.deepEqual(new Set(garbage.map(row=>row.name)),new Set(invalid.paths));
 await actor();await assert.rejects(sql('SELECT retry_video_processing($1)',[invalid.id]),/cleanup is incomplete/);
 await root();for(const object of garbage)await sql('DELETE FROM storage.objects WHERE bucket_id=$1 AND name=$2',[object.bucket_id,object.name]);
 await actor();await sql('SELECT retry_video_processing($1)',[invalid.id]);
 await root();const [retry]=await sql('SELECT input_bucket,input_prefix,output_layout,status FROM media_upload_jobs WHERE id=$1',[invalid.id]);
 assert.deepEqual(retry,{input_bucket:'staging',input_prefix:invalid.input.prefix,output_layout:2,status:'queued'});
 await sql("UPDATE media_upload_jobs SET finished_at=now()-interval '20 minutes' WHERE id=$1",[modernVideo.id]);
 await actor(owner,'service_role');let sources=await sql('SELECT * FROM finalized_video_source_cleanup_candidates()');
 assert.deepEqual(sources,[{bucket_id:'staging',name:modernVideo.input.prefix+'/source'}]);
 await root();await sql("UPDATE storage.objects SET version=gen_random_uuid()::text WHERE bucket_id='users' AND name=$1",[modernVideo.record.storage_path]);
 await actor(owner,'service_role');assert.deepEqual(await sql('SELECT * FROM finalized_video_source_cleanup_candidates()'),[]);
 await actor();await assert.rejects(sql('SELECT publish_media_upload($1,$2,$3)',[invalid.id,invalid.claim,invalid.record]),/permission denied/);
 const deleted=randomUUID(),deletedInput=await reserve(deleted);await upload(deletedInput.bucket,deletedInput.prefix+'/source');await queue(deleted);
 await root();await sql('INSERT INTO video_deletions(id,owner_id) VALUES($1,$2)',[deleted,owner]);
 await sql('DELETE FROM storage.objects WHERE bucket_id=$1 AND name=$2',[deletedInput.bucket,deletedInput.prefix+'/source']);
 await sql('DELETE FROM media_upload_jobs WHERE id=$1',[deleted]);
 await actor();await assert.rejects(reserve(deleted),/deletion has been requested/);
 await assert.rejects(upload(deletedInput.bucket,deletedInput.prefix+'/source'),/row-level security/);
 await assert.rejects(upload('media-staging',owner+'/'+deleted+'/source'),/row-level security/);
 await actor(owner,'service_role');
 for(const [bucket,path] of [['users',owner+'/videos/'+deleted+'/video.mp4'],
   ['user-videos','configured/videos/'+owner+'/videos/'+deleted+'/video.mp4'],
   ['user-images','configured/images/'+owner+'/video-previews/'+deleted+'/preview.webp']])
   await assert.rejects(upload(bucket,path),/deletion has been requested/,'A delayed worker upload must not resurrect deleted video bytes');
 console.log('PASS wrong-layout/unverified outputs never publish; failed-job cleanup targets only its unpublished outputs; retry retains the exact input location; final-identity changes block source cleanup');
} finally {await db.close();}
