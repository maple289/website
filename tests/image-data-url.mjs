import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = (await readFile('src/lib/imageStorage.ts', 'utf8')).replace(/^import .*;\r?\n/gm, '');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
let requests = 0;
new Function('exports', 'fetch', javascript)(exports, () => { requests++; throw new Error('No data URL fetch permitted'); });
const binary = Uint8Array.from({ length: 65536 }, (_, index) => index % 256);
for (const mime of ['image/jpeg','image/png','image/webp','application/octet-stream']) {
  const blob = await exports.dataUrlToBlob('data:' + mime + ';base64,' + Buffer.from(binary).toString('base64'));
  assert.equal(blob.type, mime); assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), binary);
}
assert.equal((await exports.dataUrlToBlob('DATA:image/png;BASE64,AA==')).size, 1);
for (const input of ['https://example.test/image.jpg','blob:fixture','data:image/png;base64,@@@','data:image/png,invalid','data:image/png;base64']) {
  await assert.rejects(exports.dataUrlToBlob(input), /preview image could not be read/);
}
assert.equal(requests, 0);
console.log('PASS preview data URLs preserve binary bytes/MIME, reject invalid sources and never fetch');
