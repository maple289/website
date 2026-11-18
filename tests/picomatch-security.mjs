import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const installRoot = resolve(process.env.GLOB_TEST_ROOT || '.');
const require = createRequire(resolve(installRoot, 'package.json'));
const expected = realpathSync(resolve(installRoot, 'vendor/picomatch/index.js'));
assert.equal(realpathSync(require.resolve('picomatch')), expected);
for (const consumer of ['vite', 'tinyglobby']) {
  const consumerRequire = createRequire(require.resolve(`${consumer}/package.json`));
  assert.equal(realpathSync(consumerRequire.resolve('picomatch')), expected, `${consumer} must use the patched matcher`);
}
const lock = JSON.parse(readFileSync(resolve(installRoot, 'package-lock.json'), 'utf8'));
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path === 'node_modules/picomatch' || path.endsWith('/node_modules/picomatch')) {
    assert.equal(entry.link, true, `Unpatched registry dependency: ${path}`);
    assert.equal(entry.resolved, 'vendor/picomatch');
  }
}
console.log('PASS Vite, tinyglobby and the lockfile resolve only the local patched picomatch');

const picomatch = require('picomatch');
for (const [subject, pattern, result, options] of [
  ['src/components/TaskModal.tsx', 'src/**/*.tsx', true],
  ['src/components/TaskModal.tsx', '**/*.{ts,tsx}', true],
  ['src/components/TaskModal.css', '**/*.{ts,tsx}', false],
  ['vendor/picomatch/lib/parse.js', 'vendor/**', true],
  ['src\\components\\TaskModal.tsx', 'src/**/*.tsx', true, { windows: true }],
  ['фото/Семья.jpg', '**/*.jpg', true],
  ['foobar', '+(foo|bar)', true],
  ['abab', '+(*(a)|*(b))', true],
  ['ab', '+([ab])', true],
  ['***', '+([*])', true],
  ['aaa', '+(a)', true],
  ['src/a.ts', 'src/!(*.test).ts', true],
  ['src/a.test.ts', 'src/!(*.test).ts', false],
]) assert.equal(picomatch.isMatch(subject, pattern, options), result, `${subject} against ${pattern}`);
for (const pattern of ['+(*a)', '+(*)', '*(*a)', '+(@(*a))', '+(+(a))']) {
  assert.equal(picomatch.isMatch(pattern, pattern), true, 'Risky repeated globs use the existing literal fallback');
}
console.log('PASS normal build/lint globs, Windows paths, Unicode names, finite extglobs and safe character folding');

// Run attack cases out of process: a regression must fail with a bounded timeout
// rather than hang the CI runner's event loop. No timing of only safe inputs.
const child = spawnSync(process.execPath, ['-e', `
  const assert = require('node:assert/strict');
  const pm = require(process.argv[1]);
  for (const pattern of ['+(*)', '*(*)', '+(*a)', '*(*a)', '+(*a|b)', '+(@(*a))', '+(+(a))', '+(*(ab))', '+(@(a|aa))', '+((a|aa))', '+((a)+)', '+({a,aa})', '+(ab|abab)', '+([ab]|a)', '+(a?|a)']) {
    const input = (pattern.includes('ab') ? 'ab' : 'a').repeat(128);
    assert.equal(pm.isMatch(input + '/', pattern), false, pattern);
    if (!['+(*)', '*(*)'].includes(pattern)) assert.equal(pm.isMatch(input + '!', pattern), false, pattern);
  }
`, expected], { timeout: 5000, encoding: 'utf8' });
assert.equal(child.error, undefined, `Repeated-extglob regression timed out: ${child.error?.message}`);
assert.equal(child.status, 0, child.stderr);
console.log('PASS reported single-branch repeated-extglob attacks and nested variants finish within the process timeout');

// Exercise the real discovery dependency, not only the direct matcher API.
const globby = createRequire(resolve(dirname(require.resolve('tinyglobby/package.json')), 'index.js'))('tinyglobby');
assert.ok(globby.globSync(['src/**/*.tsx'], { cwd: resolve('.'), ignore: ['**/node_modules/**'] }).includes('src/components/TaskModal.tsx'));
console.log('PASS real tinyglobby source-file discovery with the patched matcher');
