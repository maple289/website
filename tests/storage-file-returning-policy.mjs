import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setupFileStorageFixture } from './file-storage-fixture.mjs';
const db=new PGlite(),owner=randomUUID(),other=randomUUID();
const sql=async(text,args)=>(await db.query(text,args)).rows;
try {
 await setupFileStorageFixture(db);
 await db.exec('ALTER TABLE storage.objects ADD owner_id text');
 for(const id of [owner,other]){await sql('INSERT INTO auth.users VALUES($1)',[id]);await sql("INSERT INTO profiles VALUES($1,'fixture@test.invalid')",[id]);}
 await db.exec(`UPDATE streamly_internal.library_storage_control SET layout_version=2;SET ROLE authenticated;SET request.jwt.claim.sub='${owner}'`);
 const source=(await sql("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('users',$1,$2) RETURNING *",[owner+'/files/original.txt',owner]))[0];
 const metadata=(await sql('SELECT * FROM user_file_metadata WHERE source_id=$1',[source.id]))[0];
 const moved=(await sql('UPDATE storage.objects SET name=$2 WHERE id=$1 RETURNING id,name',[source.id,owner+'/files/renamed.txt']))[0];
 assert.equal(moved.id,source.id);
 assert.equal((await sql('SELECT public_id FROM user_file_metadata WHERE source_id=$1',[source.id]))[0].public_id,metadata.public_id);
 const copy=(await sql("INSERT INTO storage.objects(bucket_id,name,metadata,owner_id) SELECT bucket_id,$2,metadata,owner_id FROM storage.objects WHERE id=$1 RETURNING id",[source.id,owner+'/files/copied.txt']))[0];
 assert.notEqual(copy.id,source.id);
 await assert.rejects(sql('UPDATE storage.objects SET name=$2 WHERE id=$1 RETURNING *',[source.id,other+'/files/stolen.txt']),/row-level security/);
 await db.exec(`RESET ROLE;SET ROLE anon;SET request.jwt.claim.sub='${owner}'`);
 assert.equal((await sql("SELECT * FROM storage.objects WHERE bucket_id='users'")).length,0);
 assert.equal((await sql('SELECT can_read_owned_library_file($1,$2) allowed',[owner+'/files/renamed.txt',owner]))[0].allowed,false);
 console.log('PASS Storage INSERT/copy/move RETURNING works before metadata AFTER triggers, preserves identity and rejects foreign writes and anonymous forged-sub access');
}finally{await db.close();}
