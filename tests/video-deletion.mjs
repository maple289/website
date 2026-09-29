import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const id = '11111111-1111-4111-8111-111111111111';
const source = fs.readFileSync('supabase/functions/delete-video/index.ts', 'utf8').replace(/^import .*;\r?\n/gm, '');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
async function scenario(mode) {
  let handler;
  const calls = [];
  let objects = [{ bucket_id: 'user-videos', name: 'configured-base/owner/videos/id/stream.mp4' },
    { bucket_id: 'user-images', name: 'configured-base/owner/video-previews/id/preview.webp' }];
  const client = {
    auth: { getUser: async () => ({ data: { user: mode === 'anonymous' ? null : { id: 'session-owner' } } }) },
    rpc(name, args) {
      calls.push(name);
      assert.equal(args.p_owner, 'session-owner');
      if (name === 'begin_video_deletion') return Promise.resolve(mode === 'forbidden' ? { error: { code: '42501' } } : { data: mode !== 'processing' });
      if (name === 'video_deletion_objects') return { limit: async () => ({ data: [...objects] }) };
      return Promise.resolve({});
    },
    storage: { from: bucket => ({ remove: async paths => {
      calls.push(`remove:${bucket}`);
      if (mode === 'storage-failure') return { error: { code: 'storage_failed' } };
      objects = objects.filter(o => o.bucket_id !== bucket || !paths.includes(o.name));
      return {};
    } }) },
  };
  vm.runInNewContext(js, { createClient: () => client, Deno: { env: { get: () => 'server-config' }, serve: fn => { handler = fn; } },
    console: { info() {}, error() {} }, Response, JSON });
  const response = await handler(new Request('https://example.test/delete-video', { method: 'POST', headers: { Authorization: 'Bearer session' }, body: JSON.stringify({ id, owner_id: 'attacker-supplied-owner' }) }));
  return { response, calls, body: await response.json() };
}
for (const [mode, status] of [['anonymous', 401], ['forbidden', 403], ['processing', 202], ['storage-failure', 500], ['success', 200]]) {
  const { response, calls, body } = await scenario(mode);
  assert.equal(response.status, status, mode);
  if (mode === 'success') {
    assert.equal(body.deleted, true);
    assert.equal(calls.at(-1), 'finish_video_deletion');
    assert.ok(calls.includes('remove:user-videos'));
    assert.ok(calls.includes('remove:user-images'));
  } else assert.ok(!calls.includes('finish_video_deletion'), mode);
  console.log(`PASS ${mode}`);
}
