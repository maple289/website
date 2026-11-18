// Execute actual Edge handlers; library permissions use real isolated SQL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { setupFileStorageFixture } from './file-storage-fixture.mjs';
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111', shared = '22222222-2222-4222-8222-222222222222', outsider = '33333333-3333-4333-8333-333333333333';
const path = owner + '/Documents/Руководство.PDF', mimePath = owner + '/Documents/Guide without extension';
const groupAttachment = '44444444-4444-4444-8444-444444444444';
const sql = async (text, args = []) => (await db.query(text, args)).rows;
const tokens = new Map([['owner-token', owner], ['shared-token', shared], ['outsider-token', outsider]]);
let fileHandler, chatHandler, storageCalls = 0, grouped = true, revokedDuringFetch = false;
const log = [];
const fixturePdf = '%PDF-1.7\nsynthetic document bytes';
const formatsSource = await readFile('supabase/functions/_shared/previewFormats.ts', 'utf8');
const formatExports = {};
new Function('exports', ts.transpileModule(formatsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(formatExports);
async function install(file, assign) {
  const source = (await readFile(file, 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  new Function('Deno', 'createClient', 'fetch', 'types', 'previewFormats', 'console', code)(
    { env: { get: key => ({ SUPABASE_URL: 'https://internal.test', SUPABASE_SERVICE_ROLE_KEY: 'service-secret', SUPABASE_ANON_KEY: 'anon' })[key] }, serve: assign },
    createClient, fetchStorage, formatExports.previewFormats, formatExports.previewFormats, { error: value => log.push(value) });
}
function createClient(_base, key, options) {
  const token = options?.global?.headers?.Authorization?.replace(/^Bearer\s+/i, '') || '';
  const id = tokens.get(token);
  return {
    auth: { getUser: async supplied => ({ data: { user: tokens.has(supplied) ? { id: tokens.get(supplied) } : null }, error: null }) },
    rpc: async (name, args) => {
      if (name === 'messenger_active') return { data: !!id, error: null };
      if (name === 'messenger_attachment') return grouped && id === shared && args.p_id === groupAttachment
        ? { data: { id: groupAttachment, path: 'attachments/private.pdf', name: 'Group guide', mime: 'application/pdf', size: fixturePdf.length, version: 'fixture' }, error: null }
        : { data: null, error: { code: '42501' } };
      await db.exec('RESET ROLE');
      if (key === 'service-secret') await db.exec('SET ROLE service_role');
      else {
        assert.ok(id); await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${id}'`);
      }
      try {
        if (name === 'can_read_user_file') return { data: (await sql('SELECT can_read_user_file($1) value', [args.p_path]))[0].value, error: null };
        if (name === 'resolve_public_user_file') return { data: (await sql('SELECT resolve_public_user_file($1) value', [args.p_id]))[0].value, error: null };
        if (name === 'get_file_preview_source') return { data: (await sql('SELECT get_file_preview_source($1) value', [args.p_path]))[0].value, error: null };
        throw Error('Unexpected RPC ' + name);
      } catch (error) { return { data: null, error: { code: error.code } }; }
    },
  };
}
async function fetchStorage(url, options) {
  assert.match(url, /^https:\/\/internal\.test\/storage\/v1\/object\/authenticated\//);
  assert.equal(options.headers.Authorization, 'Bearer service-secret');
  assert.equal(options.redirect, 'error'); storageCalls++;
  if (revokedDuringFetch) grouped = false;
  return new Response(fixturePdf, { headers: { 'Content-Length': String(fixturePdf.length), 'X-Storage-Secret': 'do-not-expose' } });
}
const get = (value = path, token = 'owner-token', content = true, byId = false) => fileHandler(new Request(
  `https://site.test/functions/v1/file-preview?${new URLSearchParams({ [byId ? 'id' : 'path']: value, ...(content ? { content: '1' } : {}) })}`,
  { headers: { Authorization: 'Bearer ' + token } }));
async function bytes(response) {
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(response.headers.get('Location'), null); assert.equal(response.headers.get('X-Storage-Secret'), null);
  assert.equal(await response.text(), fixturePdf);
}
try {
  await setupFileStorageFixture(db);
  for (const id of [owner, shared, outsider]) { await sql('INSERT INTO auth.users VALUES($1)', [id]); await sql("INSERT INTO profiles VALUES($1,'fixture@example.invalid')", [id]); }
  const sharing = await readFile('supabase/migrations/20260924000000_add_file_sharing.sql', 'utf8');
  await db.exec(sharing.match(/CREATE FUNCTION public\.can_read_user_file[\s\S]*?\$\$;/)[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
  const publicFiles = await readFile('supabase/migrations/20260924010000_add_public_files.sql', 'utf8');
  for (const name of ['user_file_ancestor_paths', 'public_file_root', 'resolve_public_user_file'])
    await db.exec(publicFiles.match(new RegExp('CREATE FUNCTION public\\.' + name + '[\\s\\S]*?\\$\\$;'))[0]);
  for (const value of [path, mimePath]) await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('user-files',$1,$2)", [value, { size: fixturePdf.length, mimetype: 'application/pdf' }]);
  await install('supabase/functions/file-preview/index.ts', value => { fileHandler = value; });
  await install('supabase/functions/messenger-media/index.ts', value => { chatHandler = value; });
  const id = (await sql('SELECT public_id FROM user_file_metadata WHERE object_path=$1', [path]))[0].public_id;
  await bytes(await get());
  assert.equal((await (await get(mimePath, 'owner-token', false)).json()).kind, 'pdf');
  await bytes(await get(mimePath));
  let before = storageCalls;
  for (const response of [await get(path, 'outsider-token'), await get(path, 'anon'), await get(id, 'anon', true, true)]) assert.equal(response.status, 404);
  assert.equal(storageCalls, before, 'Unauthorized requests must never reach private storage');
  await db.exec('RESET ROLE'); await sql('INSERT INTO user_file_shares VALUES($1,$2,$3)', [owner, path, shared]);
  await bytes(await get(path, 'shared-token'));
  await db.exec('RESET ROLE'); await sql('DELETE FROM user_file_shares');
  before = storageCalls; assert.equal((await get(path, 'shared-token')).status, 404); assert.equal(storageCalls, before);
  await db.exec('RESET ROLE'); await sql('INSERT INTO user_file_shares VALUES($1,$2,NULL)', [owner, path]);
  await bytes(await get(id, 'anon', true, true));
  await db.exec('RESET ROLE'); await sql('DELETE FROM user_file_shares');
  assert.equal((await get(id, 'anon', true, true)).status, 404, 'A saved public URL must fail after revocation');
  console.log('PASS actual PDF Edge handler: owner, MIME-only PDF, shared user, anonymous/public access, revocation and denied-storage isolation');

  const chat = token => chatHandler(new Request(`https://site.test/functions/v1/messenger-media?id=${groupAttachment}&content=1`, { headers: { Authorization: 'Bearer ' + token } }));
  await bytes(await chat('shared-token'));
  before = storageCalls; assert.equal((await chat('outsider-token')).status, 404); assert.equal(storageCalls, before);
  grouped = false; assert.equal((await chat('shared-token')).status, 404);
  grouped = true; revokedDuringFetch = true;
  assert.equal((await chat('shared-token')).status, 404, 'Group access is checked again before bytes are delivered');
  console.log('PASS actual Messenger PDF handler: group-member preview, outsider denial, saved URL denial after removal, and mid-request revocation');
  assert.ok(!log.join('').includes('service-secret'));
} finally { await db.close(); }
