// Local PostgreSQL regression tests. See FILE_SHARING.md for setup.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.runtime/sharing-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pg_trgm } from '../.runtime/sharing-tests/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js';

const db = new PGlite({ extensions: { pg_trgm } });
const owner = '11111111-1111-4111-8111-111111111111';
const viewer = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
let checks = 0;
const check = (actual, expected, description) => { assert.deepEqual(actual, expected, description); checks++; console.log(`PASS ${description}`); };
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const login = async (id, role = 'authenticated') => {
  await db.exec(`RESET ROLE; SET ROLE ${role}`);
  await query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
};
const save = (path, recipients = [], everyone = false) => query('SELECT public.set_user_file_sharing($1, $2::uuid[], $3)', [path, recipients, everyone]);
const readable = async (path) => (await query('SELECT count(*)::int AS n FROM storage.objects WHERE name = $1', [path]))[0].n;
const denied = async (action, description) => {
  let failed = false;
  try { await action(); } catch (error) { failed = ['42501', 'P0001', '23503', '23514'].includes(error.code); if (!failed) throw error; }
  check(failed, true, description);
};
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1] $$;
    GRANT USAGE ON SCHEMA auth, storage, public TO authenticated, anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, anon;
  `);
  for (const migration of ['20260923000000_create_user_file_manager.sql', '20260923010000_correct_user_file_manager_metadata.sql', '20260923020000_add_user_file_search.sql', '20260924000000_add_file_sharing.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  for (const [id, email] of [[owner, 'owner@example.test'], [viewer, 'viewer@example.test'], [stranger, 'stranger@example.test']]) {
    await query('INSERT INTO auth.users VALUES ($1)', [id]);
    await query('INSERT INTO public.profiles VALUES ($1, $2)', [id, email]);
  }
  const folder = `${owner}/Team`;
  const report = `${folder}/deep/report.txt`;
  const other = `${owner}/Team-other/report.txt`;
  const lone = `${owner}/lone.txt`;
  for (const [path, isFolder] of [[folder, true], [`${folder}/deep`, true], [report, false], [other, false], [lone, false], [`${owner}/100%_files`, true], [`${owner}/100%_files/literal.txt`, false], [`${owner}/100ZZfiles/private.txt`, false]]) {
    await query('INSERT INTO public.user_file_metadata(owner_id, object_path, is_folder) VALUES ($1, $2, $3)', [owner, path, isFolder]);
    await query("INSERT INTO storage.objects(bucket_id, name) VALUES ('user-files', $1)", [isFolder ? `${path}/.folder` : path]);
  }
  await login(owner);
  check(await readable(report), 1, 'owner can read private files');
  await save(folder, [viewer]);
  await login(viewer);
  check(await readable(report), 1, 'folder share grants deep descendant storage access');
  check(await readable(other), 0, 'folder boundary excludes similarly named siblings');
  check((await query("SELECT count(*)::int n FROM public.search_user_files('report')"))[0].n, 1, 'global search returns only accessible matches');
  check((await query("SELECT count(*)::int n FROM public.search_user_files('missing')"))[0].n, 0, 'no-match search is empty');
  check((await query('SELECT object_path FROM public.list_shared_user_files()')).map((r) => r.object_path), [folder], 'shared root lists shared folder without duplicate descendants');
  check((await query('SELECT object_path FROM public.list_shared_user_files($1)', [`${folder}/deep`])).map((r) => r.object_path), [report], 'shared browsing lists immediate children');
  check((await query('SELECT * FROM public.get_file_share_indicators($1)', [[report]]))[0].everyone, false, 'inherited user-share indicator');
  await denied(() => save(folder, [stranger]), 'recipient cannot change sharing');
  await denied(() => query('SELECT * FROM public.get_user_file_sharing($1)', [folder]), 'recipient cannot enumerate grants');
  await denied(() => query("SELECT * FROM public.search_file_share_users($1, 'example')", [folder]), 'recipient cannot search owner user directory');
  check((await db.query('UPDATE storage.objects SET name = $1 WHERE name = $2', [`${folder}/renamed.txt`, report])).affectedRows, 0, 'recipient cannot rename or move storage object');
  check((await db.query('DELETE FROM storage.objects WHERE name = $1', [report])).affectedRows, 0, 'recipient cannot delete storage object');
  check((await db.query("UPDATE public.user_file_metadata SET trashed_at=now() WHERE object_path=$1", [report])).affectedRows, 0, 'recipient cannot trash metadata');
  await denied(() => query("INSERT INTO storage.objects(bucket_id, name) VALUES ('user-files', $1)", [`${folder}/unauthorized.txt`]), 'recipient cannot upload into shared folder');
  await denied(() => query('INSERT INTO public.user_file_shares(owner_id, object_path, recipient_id) VALUES ($1,$2,$3)', [owner, folder, stranger]), 'direct grant-table writes denied');

  await login(stranger);
  check(await readable(report), 0, 'unshared user cannot read a known path');
  check((await query('SELECT * FROM public.get_file_share_indicators($1)', [[report]])).length, 0, 'unshared user cannot discover sharing state');
  await login(owner);
  check((await query("SELECT * FROM public.search_file_share_users($1, 'view')", [folder])).map((r) => r.id), [viewer], 'owner can find existing users');
  await query('INSERT INTO public.user_file_metadata(owner_id, object_path) VALUES ($1,$2)', [owner, `${folder}/new.txt`]);
  await query("INSERT INTO storage.objects(bucket_id, name) VALUES ('user-files', $1)", [`${folder}/new.txt`]);
  await login(viewer);
  check(await readable(`${folder}/new.txt`), 1, 'future files automatically inherit access');
  await login(owner);
  await save(folder, [], true);
  await login(stranger);
  check(await readable(report), 1, 'Everyone grants authenticated user read access');
  await login('', 'anon');
  check(await readable(report), 0, 'Everyone does not grant anonymous URL access');
  await denied(() => save(folder, [], true), 'anonymous user cannot manage sharing');
  await login(owner);
  await save(folder);
  await login(viewer);
  check(await readable(report), 0, 'revoking Everyone and users removes descendant access');
  await login(owner);
  check(await readable(report), 1, 'owner retains access after revocation');
  await save(folder, [viewer, stranger]);
  await login(stranger);
  check(await readable(report), 1, 'second selected recipient receives access');
  await login(owner);
  await save(folder, [viewer]);
  await login(stranger);
  check(await readable(report), 0, 'removing one recipient revokes only their grant');
  await login(viewer);
  check(await readable(report), 1, 'remaining selected recipient keeps access');
  await login(owner);
  await save(lone, [viewer]);
  await save(`${owner}/100%_files`, [viewer]);
  await login(viewer);
  check(await readable(lone), 1, 'individual file sharing works');
  check((await query('SELECT public.can_read_user_file($1) ok', [`${lone}/child`]))[0].ok, false, 'file share does not grant descendants');
  check(await readable(`${owner}/100%_files/literal.txt`), 1, 'literal wildcard folder works');
  check(await readable(`${owner}/100ZZfiles/private.txt`), 0, 'percent and underscore never broaden folder access');

  await login(owner);
  await save(folder, [viewer]);
  await save(report, [stranger]);
  check((await query('SELECT * FROM public.get_user_file_sharing($1)', [report])).length, 2, 'dialog reports direct and inherited access');
  await query('UPDATE public.user_file_metadata SET trashed_at=now() WHERE object_path=$1', [folder]);
  await login(stranger);
  check(await readable(report), 0, 'trashed ancestor blocks even direct child grants');
  await login(owner);
  await query('UPDATE public.user_file_metadata SET trashed_at=NULL WHERE object_path=$1', [folder]);
  await query('UPDATE public.user_file_metadata SET object_path=$1 WHERE object_path=$2', [`${owner}/renamed.txt`, lone]);
  await query('UPDATE storage.objects SET name=$1 WHERE name=$2', [`${owner}/renamed.txt`, lone]);
  await login(viewer);
  check(await readable(`${owner}/renamed.txt`), 1, 'direct grants follow renamed metadata via foreign key');
  check((await query('SELECT public.can_read_user_file($1) ok', [lone]))[0].ok, false, 'old filename no longer grants access');
  await login(owner);
  await query('UPDATE public.user_file_metadata SET object_path=$1 WHERE object_path=$2', [`${owner}/outside.txt`, `${folder}/new.txt`]);
  await query('UPDATE storage.objects SET name=$1 WHERE name=$2', [`${owner}/outside.txt`, `${folder}/new.txt`]);
  await login(viewer);
  check(await readable(`${owner}/outside.txt`), 0, 'moving out of shared folder removes inherited access');
  await login(owner);
  await denied(() => save(folder, ['44444444-4444-4444-8444-444444444444']), 'unknown recipients rejected atomically');
  await login(viewer);
  check(await readable(report), 1, 'invalid save leaves existing grants intact');
  await login(owner);
  await query('DELETE FROM public.user_file_metadata WHERE object_path=$1', [`${owner}/renamed.txt`]);
  await login(viewer);
  check(await readable(`${owner}/renamed.txt`), 0, 'metadata deletion cascades grants and blocks orphaned storage');
  await login(owner);
  await query("INSERT INTO public.user_file_metadata(owner_id,object_path) SELECT $1::uuid,$2 || '/page-' || n || '.txt' FROM generate_series(1,120) n", [owner, folder]);
  await login(viewer);
  check((await query('SELECT * FROM public.list_shared_user_files($1,0)', [folder])).length, 51, 'shared listing is bounded with pagination lookahead');
  const first = await query("SELECT object_path FROM public.search_user_files('page-',50,0)");
  const second = await query("SELECT object_path FROM public.search_user_files('page-',50,50)");
  check([first.length, second.length, new Set([...first,...second].map((r) => r.object_path)).size], [50,50,100], 'global shared search pages do not overlap');
  console.log(`\n${checks} database security and behavior checks passed.`);
} finally { await db.close(); }
