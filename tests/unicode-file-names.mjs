// Real catalog/RLS/receipt SQL; synthetic files only, never production storage.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { setupFileStorageFixture } from './file-storage-fixture.mjs';

const db = new PGlite(), owner = randomUUID(), other = randomUUID();
const sql = async (text, args = []) => (await db.query(text, args)).rows;
const root = () => db.exec('RESET ROLE');
const actor = (id = owner) => db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub='${id}'`);
const location = async (path, write = false) => (await sql('SELECT resolve_user_file_location($1,$2) value', [path, write]))[0].value;
const key = async path => (await sql('SELECT streamly_internal.file_storage_key($1) value', [path]))[0].value;
const decode = async path => (await sql('SELECT streamly_internal.file_virtual_path($1) value', [path]))[0].value;
const storageKeyPattern = /^[\w/!.\-\*'() &$@=;:+,?]+$/;
try {
  await setupFileStorageFixture(db);
  for (const id of [owner, other]) {
    await sql('INSERT INTO auth.users VALUES($1)', [id]);
    await sql("INSERT INTO profiles VALUES($1,'fixture@example.invalid')", [id]);
  }
  await db.exec('ALTER TABLE storage.objects ADD COLUMN owner_id text; UPDATE streamly_internal.library_storage_control SET layout_version=2');
  // Install the actual analytics source trigger and inventory view, with the
  // same previously-deployed namespace/identity changes as production.
  const analyticsBase = await readFile('supabase/migrations/20261002000000_admin_analytics.sql', 'utf8');
  const analyticsLayout = await readFile('supabase/migrations/20261108030000_storage_analytics_identity.sql', 'utf8');
  await db.exec(`CREATE TABLE analytics_content(content_type text,content_id uuid,owner_id uuid,PRIMARY KEY(content_type,content_id));
    CREATE TABLE fixture_analytics_actions(action text,source uuid);
    CREATE FUNCTION analytics_log(uuid,text,text,uuid) RETURNS void LANGUAGE sql AS
    $$INSERT INTO public.fixture_analytics_actions VALUES($2,$4)$$;`);
  await db.exec(analyticsLayout.match(/CREATE FUNCTION streamly_internal\.canonical_file_id[\s\S]*?\$\$;/)[0]);
  await db.exec(analyticsBase.match(/CREATE FUNCTION public\.analytics_source_change[\s\S]*?END; \$\$;/)[0]
    .replace("NEW.bucket_id<>'user-files'", "(NEW.bucket_id<>'user-files' AND NOT (NEW.bucket_id='users' AND split_part(NEW.name,'/',2)='files' AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=2)))")
    .replace("kind:='file'; source:=NEW.id;", "kind:='file'; source:=streamly_internal.canonical_file_id(NEW.id);"));
  await db.exec('CREATE TRIGGER analytics_file AFTER INSERT OR UPDATE OF name ON storage.objects FOR EACH ROW EXECUTE FUNCTION analytics_source_change()');
  for (const view of ['analytics_media_objects', 'analytics_object_inventory'])
    await db.exec(analyticsLayout.match(new RegExp('CREATE OR REPLACE VIEW public\\.' + view + '[\\s\\S]*?;'))[0]);
  await db.exec(await readFile('supabase/migrations/20261118010000_unicode_file_names.sql', 'utf8'));
  await db.exec('GRANT SELECT ON analytics_content,fixture_analytics_actions,analytics_object_inventory TO authenticated');
  const folder = owner + '/EVERYONE', source = folder + '/MyHostage_User_Guide_RU.pdf';
  const destination = folder + '/MyHostage_Руководство пользователя.pdf';
  for (const name of ['plain.txt', 'Руководство пользователя.pdf', 'Фото/Семья/ёлка.jpg', 'café.txt', '报告.pdf', '📷.png', '100%.txt', 'a#b.txt', 'a[b].txt']) {
    const path = owner + '/' + name, physical = await key(path);
    assert.match(physical, storageKeyPattern);
    assert.equal(await decode(physical), path);
  }
  assert.equal(await key(owner + '/normal folder/file.txt'), owner + '/files/normal folder/file.txt');
  assert.notEqual(await key(owner + '/é.txt'), await key(owner + '/é.txt'), 'Do not merge distinct Unicode spellings');
  for (const bad of [owner + '/files-utf8/ff', owner + '/files-utf8/2e2e', owner + '/files-utf8/612f62',
    owner + '/files-utf8/706c61696e2e747874', owner + '/files-utf8/0a', owner + '/files-utf8/0', owner + '/videos/file']) {
    assert.equal(await decode(bad), null, 'Reject invalid UTF-8, traversal, separators, aliases, and unrelated namespaces');
  }
  await assert.rejects(key(owner + '/' + 'я'.repeat(260)), /too long/);
  console.log('PASS storage-safe keys round-trip Russian, accents, CJK, emoji and reserved ASCII; malformed encodings and traversal are rejected');

  await actor();
  await sql('SELECT create_user_file_folder($1)', [folder]);
  const originalKey = (await location(source, true)).path;
  const original = (await sql("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('users',$1,$2) RETURNING *", [originalKey, owner]))[0];
  const originalPublicId = (await sql('SELECT public_id FROM user_file_metadata WHERE object_path=$1', [source]))[0].public_id;
  await root();
  await sql('INSERT INTO user_file_shares VALUES($1,$2,$3)', [owner, source, other]);
  const originalCatalog = await readFile('supabase/migrations/20261108020000_user_file_catalog_compatibility.sql', 'utf8');
  await db.exec(originalCatalog.match(/CREATE FUNCTION public\.resolve_user_file_location[\s\S]*?\$\$;/)[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
  // Reproduce the already-started receipt created before this fix. The first
  // destination was rejected by the object API, so its source is still intact.
  await actor();
  const operation = randomUUID();
  const plan = (await sql('SELECT begin_file_operation($1,$2,$3,false,false) value', [operation, source, destination]))[0].value;
  assert.equal((await sql('SELECT file_operation_step($1,$2,false,false) done', [operation, source]))[0].done, false);
  assert.ok(!storageKeyPattern.test((await location(destination, true)).path), 'Reproduce the original object-API rejection');
  await root();
  await db.exec(await readFile('supabase/migrations/20261118010000_unicode_file_names.sql', 'utf8'));
  await actor();
  const target = await location(destination, true);
  assert.match(target.path, storageKeyPattern);
  assert.ok(target.path.includes('/files-utf8/'));
  const moved = (await sql('UPDATE storage.objects SET name=$2 WHERE id=$1 RETURNING id', [original.id, target.path]))[0];
  assert.equal(moved.id, original.id);
  assert.equal((await sql('SELECT file_operation_step($1,$2,false,false) done', [operation, source]))[0].done, true, 'Recover a lost move response by object identity');
  for (const row of plan.metadata) await sql('SELECT file_operation_step($1,$2,true,true)', [operation, row.object_path]);
  await sql('SELECT finish_file_operation($1)', [operation]);
  assert.deepEqual(await sql('SELECT unfinished_file_operations()'), []);
  assert.equal((await location(destination)).path, target.path);
  assert.equal((await sql('SELECT public_id FROM user_file_metadata WHERE object_path=$1', [destination]))[0].public_id, originalPublicId);
  assert.equal((await sql('SELECT count(*)::int count FROM analytics_content WHERE content_id=$1', [original.id]))[0].count, 1);
  assert.equal((await sql("SELECT count(*)::int count FROM fixture_analytics_actions WHERE action='renamed' AND source=$1", [original.id]))[0].count, 1);
  await root();
  assert.equal((await sql('SELECT category FROM analytics_object_inventory WHERE id=$1', [original.id]))[0].category, 'Files');
  await actor();
  assert.deepEqual((await sql('SELECT name FROM file_manager_objects($1)', [folder])).map(row => row.name), ['MyHostage_Руководство пользователя.pdf']);
  await actor(other);
  assert.equal((await location(destination)).id, original.id, 'Direct sharing follows the rename');
  await assert.rejects(location(destination, true), /Invalid destination/);
  await assert.rejects(sql("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('users',$1,$2)", [target.path + '00', other]), /row-level security/);
  console.log('PASS the original saved rename resumes without replacing its receipt; object/public identity, Russian display name and sharing survive');

  await actor();
  const nested = folder + '/Русская папка', leaf = nested + '/Файл.txt';
  await sql('SELECT create_user_file_folder($1)', [nested]);
  const markerKey = (await location(nested + '/.folder', true)).path;
  const marker = (await sql("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('users',$1,$2) RETURNING id", [markerKey, owner]))[0];
  assert.equal((await sql('SELECT count(*)::int count FROM analytics_content WHERE content_id=$1', [marker.id]))[0].count, 0, 'Encoded folder markers are not analytics files');
  const leafKey = (await location(leaf, true)).path;
  await sql("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('users',$1,$2)", [leafKey, owner]);
  const copyDestination = owner + '/Копия', copyId = randomUUID();
  const copy = (await sql('SELECT begin_file_operation($1,$2,$3,true,false) value', [copyId, nested, copyDestination]))[0].value;
  for (const path of copy.objects) {
    const to = await location(copyDestination + path.slice(nested.length), true);
    await sql('SELECT file_operation_step($1,$2,false,false)', [copyId, path]);
    await sql("INSERT INTO storage.objects(bucket_id,name,metadata,owner_id) SELECT bucket_id,$2,metadata,$3 FROM storage.objects WHERE name=$1", [(await location(path)).path, to.path, owner]);
    await sql('SELECT file_operation_step($1,$2,false,true)', [copyId, path]);
  }
  for (const row of copy.metadata) {
    const path = copyDestination + row.object_path.slice(nested.length);
    await sql('SELECT file_operation_step($1,$2,true,false)', [copyId, row.object_path]);
    await sql('INSERT INTO user_file_metadata(owner_id,object_path,is_folder) VALUES($1,$2,$3) ON CONFLICT(owner_id,object_path) DO NOTHING', [owner, path, row.is_folder]);
    await sql('SELECT file_operation_step($1,$2,true,true)', [copyId, row.object_path]);
  }
  await sql('SELECT finish_file_operation($1)', [copyId]);
  assert.equal((await location(copyDestination + '/Файл.txt')).bucket, 'users');
  assert.ok((await location(leaf)).id, 'Copy retains original bytes');
  console.log('PASS Russian folder/file Copy uses virtual suffixes and independently confirmed storage/metadata steps');

  // Verify physical-key decoding is also used by permanent deletion's write
  // lock. No new deletion caller is introduced by the filename change.
  await root();
  await sql('UPDATE user_file_metadata SET trashed_at=now() WHERE owner_id=$1 AND (object_path=$2 OR starts_with(object_path,$2||\'/\'))', [owner, copyDestination]);
  const stamp = (await sql('SELECT trashed_at FROM user_file_metadata WHERE object_path=$1', [copyDestination]))[0].trashed_at;
  await db.exec('SET ROLE service_role');
  const deletion = (await sql('SELECT begin_user_file_deletion($1,$2,$3,true) id', [owner, copyDestination, stamp]))[0].id;
  const deletionObjects = await sql('SELECT * FROM user_file_deletion_objects($1,$2)', [deletion, owner]);
  assert.equal(deletionObjects.length, 2);
  assert.match(deletionObjects[0].name, storageKeyPattern);
  await actor();
  const blocked = (await location(copyDestination + '/ещё.txt', true)).path;
  await assert.rejects(sql("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('users',$1,$2)", [blocked, owner]), /deletion is in progress/);
  await actor(other);
  await assert.rejects(location(copyDestination + '/Файл.txt'), /unavailable/);
  await root();
  await db.exec('UPDATE streamly_internal.library_storage_control SET pause_library_writes=true');
  await actor();
  await assert.rejects(location(owner + '/Новое.pdf', true), /maintenance/);
  console.log('PASS encoded files retain owner/RLS, Trash deletion resolution, pending-deletion locks and storage maintenance gates');

  // Exercise the exact preview resolvers too, including their source ID binding.
  await root();
  const locations = await readFile('supabase/migrations/20261108010000_storage_location_compatibility.sql', 'utf8');
  for (const name of ['get_file_preview_source', 'get_preview_source_by_id'])
    await db.exec(locations.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '[\\s\\S]*?\\$\\$;'))[0]);
  await db.exec(await readFile('supabase/migrations/20261118010000_unicode_file_names.sql', 'utf8'));
  await db.exec('SET ROLE service_role');
  for (const [name, arg] of [['get_file_preview_source', destination], ['get_preview_source_by_id', original.id]]) {
    const preview = (await sql(`SELECT ${name}($1) value`, [arg]))[0].value;
    assert.equal(preview.id, original.id);
    assert.equal(preview.path, target.path);
  }
  console.log('PASS preview source resolvers bind Russian names to the actual storage object after rename');
} finally {
  await db.close();
}
