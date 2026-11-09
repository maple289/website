import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupFileStorageFixture} from './file-storage-fixture.mjs';
const db=new PGlite(),owner=randomUUID(),run=randomUUID(),hash='a'.repeat(64);
const sql=async(text,args)=>(await db.query(text,args)).rows;
const root=()=>db.exec('RESET ROLE');
const service=()=>db.exec('RESET ROLE;SET ROLE service_role');
const remove=id=>sql('DELETE FROM storage.objects WHERE id=$1 RETURNING id',[id]);
const paused=()=>db.exec('UPDATE streamly_internal.library_storage_control SET layout_version=2,pause_media_claims=true,pause_library_writes=true');
try {
 await setupFileStorageFixture(db);
 await db.exec('CREATE FUNCTION resolve_public_user_file(uuid) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$');
 const links=await readFile('supabase/migrations/20261108090000_revocable_library_storage_links.sql','utf8');
 await db.exec(links.match(/CREATE VIEW streamly_internal\.library_gateway_sources AS[\s\S]*?;/)[0]);
 await db.exec(await readFile('supabase/migrations/20261109010000_verified_retired_storage_cleanup.sql','utf8'));
 await sql('INSERT INTO auth.users VALUES($1)',[owner]);await sql("INSERT INTO profiles VALUES($1,'fixture@example.invalid')",[owner]);
 const oldPath=owner+'/fixture.txt',newPath=owner+'/files/fixture.txt';
 const old=(await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('user-files',$1) RETURNING *",[oldPath]))[0];
 const copy=(await sql("INSERT INTO storage.objects(bucket_id,name) VALUES('users',$1) RETURNING *",[newPath]))[0];
 const metadata=(await sql('SELECT * FROM user_file_metadata WHERE object_path=$1',[oldPath]))[0];
 await sql(`INSERT INTO streamly_internal.storage_migration_objects(old_object_id,owner_id,resource_type,resource_id,media_role,
 old_bucket,old_key,old_version,old_created_at,old_updated_at,new_object_id,new_bucket,new_key,new_version,bytes,sha256,verified_at,retired_at)
 VALUES($1,$2,'file',$3,'file','user-files',$4,$5,$6,$7,$8,'users',$9,$10,12,$11,now(),now())`,
 [old.id,owner,metadata.public_id,oldPath,old.version,old.created_at,old.updated_at,copy.id,newPath,copy.version,hash]);
 await sql("UPDATE user_file_metadata SET storage_bucket='users',source_id=$1 WHERE public_id=$2",[copy.id,metadata.public_id]);
 let saved=(await sql('SELECT * FROM user_file_metadata WHERE public_id=$1',[metadata.public_id]))[0];
 await paused();await service();
 await assert.rejects(remove(old.id),/maintenance/,'A service credential alone cannot remove a retired duplicate during maintenance');
 await root();
 await sql(`INSERT INTO streamly_internal.retired_storage_cleanup(old_object_id,run_id,manifest_sha256,sha256,new_object_id,new_version,new_updated_at,new_bytes,expires_at)
 VALUES($1,$2,$3,$3,$4,$5,$6,12,now()+interval '10 minutes')`,[old.id,run,hash,copy.id,copy.version,copy.updated_at]);
 await service();await assert.rejects(remove(copy.id),/maintenance/,'An intent never authorizes deleting the active replacement');
 await assert.rejects(sql('SELECT * FROM streamly_internal.retired_storage_cleanup'),/permission denied/);
 await assert.rejects(sql('SELECT streamly_internal.approved_retired_storage_delete(o) FROM storage.objects o LIMIT 1'),/permission denied/);
 await root();await sql("UPDATE streamly_internal.retired_storage_cleanup SET new_version='changed'");
 await service();await assert.rejects(remove(old.id),/maintenance/,'A changed replacement fails closed');
 await root();await sql("UPDATE streamly_internal.retired_storage_cleanup SET new_version=$1,created_at=now()-interval '1 hour',expires_at=now()-interval '50 minutes'",[copy.version]);
 await service();await assert.rejects(remove(old.id),/maintenance/,'Expired proofs never authorize cleanup');
 await root();await sql("UPDATE streamly_internal.retired_storage_cleanup SET created_at=now(),expires_at=now()+interval '10 minutes'");
 await sql('UPDATE user_file_metadata SET trashed_at=now() WHERE public_id=$1',[metadata.public_id]);
 await service();await assert.rejects(remove(old.id),/maintenance/,'The replacement must still belong to a current resource');
 await root();await sql('UPDATE user_file_metadata SET trashed_at=NULL WHERE public_id=$1',[metadata.public_id]);
 await sql('UPDATE streamly_internal.retired_storage_cleanup SET sha256=$1',['b'.repeat(64)]);
 await service();await assert.rejects(remove(old.id),/maintenance/,'A changed hash proof fails closed');
 await root();await sql('UPDATE streamly_internal.retired_storage_cleanup SET sha256=$1',[hash]);
 await db.exec(`SET ROLE authenticated;SET request.jwt.claim.sub='${owner}'`);
 assert.equal((await remove(old.id)).length,0,'Browser roles cannot consume an operator proof');
 await root();await sql("UPDATE streamly_internal.storage_migration_objects SET retired_at=NULL");
 await service();await assert.rejects(remove(old.id),/maintenance/,'Unretired aliases are ineligible');
 await root();await sql('UPDATE streamly_internal.storage_migration_objects SET retired_at=now()');
 saved=(await sql('SELECT * FROM user_file_metadata WHERE public_id=$1',[metadata.public_id]))[0];
 await service();assert.equal((await remove(old.id)).length,1,'Only the exact verified retired duplicate may be removed');
 await root();
 assert.deepEqual((await sql('SELECT * FROM user_file_metadata WHERE public_id=$1',[metadata.public_id]))[0],saved,'Current metadata must survive old-copy deletion');
 assert.equal((await sql('SELECT count(*)::int n FROM storage.objects WHERE id=$1',[copy.id]))[0].n,1);
 assert.equal((await sql('SELECT count(*)::int n FROM streamly_internal.storage_migration_objects'))[0].n,1,'Aliases remain after cleanup');
 assert.equal((await sql('SELECT count(*)::int n FROM streamly_internal.retired_storage_cleanup'))[0].n,1,'Receipts remain after cleanup');
 // Empty folders are metadata in the new layout; their old zero-byte marker
 // can be retired without creating a second permanent placeholder.
 const folderPath=owner+'/empty',marker=(await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('user-files',$1,'{\"size\":0}') RETURNING *",[folderPath+'/.keep']))[0];
 const folder=(await sql('SELECT * FROM user_file_metadata WHERE object_path=$1',[folderPath]))[0];
 await sql("UPDATE user_file_metadata SET storage_bucket='users',source_id=NULL WHERE public_id=$1",[folder.public_id]);
 await sql(`INSERT INTO streamly_internal.storage_migration_objects(old_object_id,owner_id,resource_type,resource_id,media_role,
 old_bucket,old_key,old_version,old_created_at,old_updated_at,bytes,sha256,verified_at,retired_at)
 VALUES($1,$2,'folder',$3,'folder','user-files',$4,$5,$6,$7,0,$8,now(),now())`,[marker.id,owner,folder.public_id,marker.name,marker.version,marker.created_at,marker.updated_at,hash]);
 await sql("INSERT INTO streamly_internal.retired_storage_cleanup(old_object_id,run_id,manifest_sha256,sha256,expires_at) VALUES($1,$2,$3,$3,now()+interval '10 minutes')",[marker.id,run,hash]);
 const savedFolder=(await sql('SELECT * FROM user_file_metadata WHERE public_id=$1',[folder.public_id]))[0];
 await service();assert.equal((await remove(marker.id)).length,1);
 await root();assert.deepEqual((await sql('SELECT * FROM user_file_metadata WHERE public_id=$1',[folder.public_id]))[0],savedFolder);
 console.log('PASS retired duplicate cleanup: private intents, maintenance gates, exact versions, expiry, browser denial, active replacement/metadata protection and durable aliases');
} finally {await db.close()}
