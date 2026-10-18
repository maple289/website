// Validate production worker overlays with synthetic configuration only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const overlays = ['media-worker', 'file-preview-worker', 'analytics-collector', 'email-dispatcher', 'push-dispatcher'];
const result = spawnSync('docker', ['compose', ...overlays.flatMap(name => ['-f', `deploy/${name}.compose.yml`]), 'config', '--format', 'json'], {
  encoding: 'utf8',
  env: { ...process.env, STREAMLY_PROJECT_ROOT: process.cwd(), SERVICE_ROLE_KEY: 'isolated-fixture', GLOBAL_S3_BUCKET: 'fixture', STORAGE_TENANT_ID: 'fixture' },
});
assert.equal(result.status, 0, result.stderr || result.error?.message);
const config = JSON.parse(result.stdout);
for (const [name, service] of Object.entries(config.services)) {
  for (const mount of service.tmpfs || []) {
    assert.equal(typeof mount, 'string', `${name}: tmpfs must be a mount string`);
    assert.ok(path.posix.isAbsolute(mount.split(':')[0]), `${name}: invalid tmpfs path ${mount}`);
  }
}
const worker = config.services['email-dispatcher'];
assert.equal(worker.read_only, true);
assert.equal(worker.tmpfs.length, 1, 'comma-separated mount options must remain one YAML string');
assert.equal(worker.tmpfs[0].split(':')[0], '/tmp');
console.log('PASS production worker overlays normalize successfully with absolute tmpfs paths');

// Exercise the mount on the Docker daemon, including the worker UID and sandbox.
// The CI frontend image already contains sh; no production volumes or network.
const run = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only',
  '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--tmpfs', worker.tmpfs[0], '--entrypoint', 'sh', 'streamly-web:ci', '-c',
  'touch /tmp/fixture-heartbeat && test -f /tmp/fixture-heartbeat'], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.error?.message);
console.log('PASS email worker tmpfs mounts and permits heartbeat writes with an unprivileged read-only container');
