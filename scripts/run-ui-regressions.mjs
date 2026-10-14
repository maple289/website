// Isolated fixture servers; no production configuration, traffic or records.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createPublicPreviewServer } from '../tests/public-previews-server.mjs';
const suites = {
  'messenger-call-layout': 'call-ui-test', 'messenger-call-audio-ui': 'call-ui-test',
  'messenger-people-ui': 'upload-test', 'messenger-deletion-ui': 'upload-test',
  'content-context': 'upload-test', 'public-navigation': 'upload-test',
  'settings-navigation': 'settings-test', 'file-previews': 'preview-test',
  'file-integrity': 'upload-test', 'video-bitrate-settings-browser': 'upload-test',
  'audit-chunk-recovery': 'upload-test',
  'initial-password-ui': 'upload-test',
  'public-previews': 'public-preview-test',
  'public-consumption': 'public-preview-test',
  'video-player-recovery': 'public-preview-test',
  'media-double-tap': 'public-preview-test',
};
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(suites)) {
  if (!suites[name]) throw Error('Unknown fixture suite: ' + name);
  const server = ['public-previews', 'public-consumption', 'video-player-recovery', 'media-double-tap'].includes(name) ? await createPublicPreviewServer() : await createServer({ configFile: false, root: process.cwd(), plugins: [react()], envPrefix: [],
    resolve: { alias: { '@': path.resolve('src') } },
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(`https://${suites[name]}.supabase.co`), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('isolated-fixture') },
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['tests/' + name + '.mjs'], { stdio: 'inherit', env: { ...process.env, TEST_BASE_URL: `http://127.0.0.1:${port}` } });
      child.on('error', reject); child.on('exit', resolve);
    });
    if (status !== 0) throw Error(name + ' failed: ' + status);
  } finally { await server.close(); }
}
