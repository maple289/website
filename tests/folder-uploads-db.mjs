// Real existing SQL functions/RLS, synthetic storage rows, no production access.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setupFileStorageFixture } from './file-storage-fixture.mjs';
const db = new PGlite(), owner = randomUUID(), other = randomUUID();
const sql = async (text, args = []) => (await db.query(text, args)).rows;
const actor = id => db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub='${id}'`);
try {
 await setupFileStorageFixture(db);
 await sql('INSERT INTO auth.users VALUES($1),($2)', [owner, other]);
 await sql("INSERT INTO profiles VALUES($1,'owner@example.test'),($2,'other@example.test')", [owner, other]);
 await db.exec('UPDATE streamly_internal.library_storage_control SET layout_version=2');
 await actor(owner);
 const root = owner + '/Existing nested/Upload folder';
 for (const p of [owner + '/Existing nested', root, root + '/App', root + '/App/Empty', root + '/Data', root + '/Other']) await sql('SELECT create_user_file_folder($1)', [p]);
 const files = [root + '/App/README', root + '/Data/é & 文件.txt', root + '/Other/a.bin'];
 for (const [index, p] of files.entries()) {
  const loc = (await sql('SELECT resolve_user_file_location($1,true) value', [p]))[0].value;
  assert.equal(loc.bucket, 'users');
  await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('users',$1,$2::jsonb)", [loc.path, JSON.stringify({ size: index + 10, mimetype: 'application/octet-stream' })]);
 }
 assert.deepEqual((await sql('SELECT name,id FROM file_manager_objects($1)', [root])).map(row => [row.name, row.id]), [['App', null], ['Data', null], ['Other', null]]);
 const children = await sql('SELECT name,id FROM file_manager_objects($1)', [root + '/App']);
 assert.equal(children[0].name, 'Empty'); assert.equal(children[0].id, null); assert.ok(children[1].id);
 const records = await sql('SELECT * FROM user_file_metadata ORDER BY object_path');
 assert.equal(records.filter(row => row.is_folder).length, 6);
 assert.equal(records.filter(row => !row.is_folder).length, 3);
 assert.equal(records.filter(row => !row.is_folder).reduce((sum, row) => sum + Number(row.file_size), 0), 33);
 for (const p of files) {
  const loc = (await sql('SELECT resolve_user_file_location($1) value', [p]))[0].value;
  const row = records.find(row => row.object_path === p);
  assert.equal(loc.id, row.source_id);
  assert.equal((await sql('SELECT count(*)::int n FROM storage.objects WHERE id=$1 AND bucket_id=$2 AND name=$3', [loc.id, loc.bucket, loc.path]))[0].n, 1);
 }
 await assert.rejects(sql('SELECT create_user_file_folder($1)', [root]), /duplicate/);
 await assert.rejects(sql('SELECT create_user_file_folder($1)', [files[0]]), /file already/);
 await assert.rejects(sql('SELECT create_user_file_folder($1)', [files[0] + '/invalid']), /file cannot contain/);
 await assert.rejects(sql('SELECT resolve_user_file_location($1,true)', [owner + '/../escape']), /Invalid destination/);
 await actor(other);
 await assert.rejects(sql('SELECT create_user_file_folder($1)', [root + '/foreign']), /Invalid folder/);
 await assert.rejects(sql('SELECT resolve_user_file_location($1,true)', [root + '/foreign']), /Invalid destination/);
 await assert.rejects(sql('SELECT * FROM file_manager_objects($1)', [root]), /own folders/);
 await actor(owner);
 await assert.rejects(sql('INSERT INTO user_file_metadata(owner_id,object_path) VALUES($1,$2)', [owner, root + '/orphan']), /does not exist/);
 assert.equal((await sql('SELECT count(*)::int n FROM user_file_metadata'))[0].n, 9);
 console.log('PASS folder hierarchy, empty directories, file sizes, physical key/catalog identities, Unicode, collision guards, orphan rejection and cross-owner RLS in actual SQL');
} finally { await db.close(); }
