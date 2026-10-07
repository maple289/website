import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/temporaryShareRouting.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', javascript)(exports);
const { temporarySharePath, temporaryShareRoute } = exports;
const token = 'a'.repeat(64);

for (const [base, prefix] of [['/', '/'], ['/video/', '/video/'], ['/video', '/video/'], ['/apps/media/', '/apps/media/']]) {
  const path = temporarySharePath(token, base);
  assert.equal(path, `${prefix}share/${token}`);
  assert.deepEqual(temporaryShareRoute(path, base), { token });
  assert.deepEqual(temporaryShareRoute(`${path}/`, base), { token });
  assert.deepEqual(temporaryShareRoute(`${prefix}share/invalid`, base), { token: '' });
  assert.deepEqual(temporaryShareRoute(`${prefix}share`, base), { token: '' });
  assert.equal(temporaryShareRoute(`${prefix}library`, base), null);
  assert.equal(temporaryShareRoute(`${prefix}share-other/${token}`, base), null);
}
assert.equal(temporaryShareRoute(`/share/${token}`, '/video/'), null);
assert.equal(temporaryShareRoute(`/video/share/${token}`, '/'), null);
assert.deepEqual(temporaryShareRoute(`/video/share/${token}/extra`, '/video/'), { token: '' });
assert.equal(new URL(temporarySharePath(token, '/video/'), 'https://myhostage.ca').href, `https://myhostage.ca/video/share/${token}`);
console.log('Temporary share routes pass for root and subdirectory hosting.');
