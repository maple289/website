// Execute the actual Edge handler with deterministic mocked Supabase/Storage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
let source = await fs.readFile(new URL('../supabase/functions/temporary-share/index.ts', import.meta.url), 'utf8');
source = source.replace(/^import .*;\r?\n/gm, '');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const owner = '11111111-1111-4111-8111-111111111111';
const hash = async token => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
const token = 'a'.repeat(64), tokenHash = await hash(token);
let handler, stored = [], denied = false, deleted = false, trashed = false, storageCalls = [], created = [], tableReads = [];
let link = { id: 'fixture', owner_id: owner, content_type: 'photo', content_id: 'photo-id', photo_id: 'photo-id', token_hash: tokenHash, revoked_at: null, expires_at: new Date(Date.now()+86400000).toISOString() };
function createClient(base, key) {
  return {
    auth: { getUser: async () => ({ data: { user: denied ? null : { id: owner } }, error: null }) },
    rpc: async (name, args) => {
      if (name === 'create_temporary_share') { created.push(args); return { data: { id: 'new-link', expires_at: link.expires_at }, error: null }; }
      if (name === 'temporary_share_children') return { data: [{ name: 'child.txt', relative: 'child.txt', isFolder: false }], error: null };
      throw new Error('Unexpected RPC');
    },
    from: table => {
      tableReads.push(table);
      const filters = {};
      const query = { select: () => query, eq: (key, value) => { filters[key] = value; return query; }, in: () => query, not: () => { stored = trashed ? [{ object_path: `${owner}/Root` }] : []; return Promise.resolve({ data: stored, error: null }); },
        maybeSingle: async () => {
          if (table === 'temporary_content_shares') return { data: filters.token_hash === tokenHash ? link : null, error: null };
          if (deleted) return { data: null, error: null };
          if (table === 'photos') return { data: { owner_id: owner, storage_path: `${owner}/photo.jpg`, file_name: 'Photo.jpg', mime_type: 'image/jpeg' } };
          if (table === 'videos') return { data: { owner_id: owner, storage_path: `${owner}/video.mp4`, processed_storage_path: `${owner}/processed.mp4`, file_name: 'Video.mp4', mime_type: 'video/mp4', processing_status: 'ready' } };
          if (table === 'storage_settings') return { data: { images_base_path: 'images', videos_base_path: 'videos' } };
          if (table === 'user_file_metadata') { const path = filters.object_path; return { data: { object_path: path, is_folder: path === `${owner}/Root`, trashed_at: null, mime_type: 'text/plain' } }; }
          throw new Error('Unexpected table');
        } };
      return query;
    },
  };
}
const fetchStorage = async (url, options) => {
  storageCalls.push({ url, options });
  return new Response('fixture bytes', { status: options.headers.Range ? 206 : 200, headers: { 'Content-Length': '13', 'Content-Range': 'bytes 0-12/13', 'Accept-Ranges': 'bytes' } });
};
new Function('Deno','createClient','fetch',javascript)({ env: { get: key => ({ SUPABASE_URL: 'https://internal.test', SUPABASE_SERVICE_ROLE_KEY: 'server-only-secret', SUPABASE_ANON_KEY: 'anon-key' })[key] }, serve: callback => { handler = callback; } }, createClient, fetchStorage);
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
const get = (suffix='', headers) => handler(new Request(`https://site.test/functions/v1/temporary-share?token=${token}${suffix}`, { headers }));
let response = await get('&metadata=1');
assert.deepEqual(await response.json(), { type: 'photo', name: 'Photo.jpg', mime: 'image/jpeg' });
assert.equal(storageCalls.length, 0);
response = await get('', { Range: 'bytes=0-12' });
assert.equal(response.status, 206); assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
assert.equal(storageCalls[0].options.headers.Range, 'bytes=0-12');
assert.match(storageCalls[0].url, /images\/11111111.*\/photo.jpg$/);
assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
assert.equal((await response.text()).includes('server-only-secret'), false);
pass('anonymous single-item metadata; proxied range bytes; no signed URLs, owner IDs or service secrets');
link.expires_at = new Date(Date.now()-1).toISOString();
response = await get(); assert.equal(response.status, 410); assert.equal((await response.json()).error, 'This share link has expired.');
link.revoked_at = new Date().toISOString(); response = await get(); assert.equal(response.status, 404); assert.equal((await response.json()).error, 'This share link is no longer available.');
link.revoked_at = null; link.expires_at = new Date(Date.now()+86400000).toISOString(); deleted = true;
assert.equal((await get()).status, 404); deleted = false;
assert.equal(storageCalls.length, 1);
pass('exact expiry boundary, revocation and deletion block bytes on every request');
link.content_type = 'folder'; link.file_path = `${owner}/Root`;
assert.equal((await get('&child=../Other')).status, 404);
assert.equal((await get('&child=%2FOther')).status, 404);
assert.equal((await get('&child=a%5Cb')).status, 404);
response = await get('&metadata=1'); const folder = await response.json(); assert.equal(folder.type, 'folder'); assert.equal(folder.entries[0].relative, 'child.txt');
response = await get('&child=child.txt&metadata=1'); assert.equal((await response.json()).name, 'child.txt');
trashed = true; assert.equal((await get('&child=child.txt')).status, 404); trashed = false;
pass('folder scope permits its children only; traversal and trashed ancestors denied');
denied = true;
assert.equal((await handler(new Request('https://site.test/temporary-share', { method: 'POST', body: JSON.stringify({ type: 'photo', id: 'photo-id' }) }))).status, 401);
denied = false;
const tokens = [];
for (let i = 0; i < 2; i++) {
  response = await handler(new Request('https://site.test/temporary-share', { method: 'POST', headers: { Authorization: 'Bearer session' }, body: JSON.stringify({ type: 'photo', id: 'photo-id' }) }));
  tokens.push((await response.json()).token);
  assert.match(tokens[i], /^[a-f0-9]{64}$/); assert.equal(created[i].p_hash, await hash(tokens[i])); assert.equal(JSON.stringify(created[i]).includes(tokens[i]), false);
}
assert.notEqual(tokens[0], tokens[1]);
pass('creation requires session; independent 256-bit Web Crypto tokens; database receives hashes only');
assert.equal((await handler(new Request('https://site.test/temporary-share?token=bad'))).status, 404);
assert.equal((await handler(new Request('https://site.test/temporary-share', { method: 'DELETE' }))).status, 405);
console.log(`${checks} Edge security checks passed`);
