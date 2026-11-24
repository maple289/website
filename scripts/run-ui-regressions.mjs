// Isolated fixture servers; no production configuration, traffic or records.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createPublicPreviewServer } from '../tests/public-previews-server.mjs';
const suites = {
  'folder-uploads-ui': 'upload-test',
  'messenger-notifications-ui': 'notification-test',
  'messenger-group-sharing-ui': 'upload-test',
  'media-group-filter': 'upload-test',
  'media-uploads': 'upload-test',
  'messenger-call-layout': 'call-ui-test', 'messenger-call-audio-ui': 'call-ui-test',
  'messenger-people-ui': 'upload-test', 'messenger-deletion-ui': 'upload-test',
  'content-context': 'upload-test', 'public-navigation': 'upload-test',
  'settings-navigation': 'settings-test', 'file-previews': 'preview-test', 'pdf-preview': 'preview-test',
  'file-integrity': 'upload-test', 'video-bitrate-settings-browser': 'upload-test',
  'audit-chunk-recovery': 'upload-test',
  'initial-password-ui': 'upload-test',
  'admin-statistics-reset-ui': 'upload-test',
  'video-preview-replacement': 'upload-test',
  'public-previews': 'public-preview-test',
  'public-consumption': 'public-preview-test',
  'video-player-recovery': 'public-preview-test',
  'media-double-tap': 'public-preview-test',
};
// Exercise the deployed connection policy, rather than Vite's permissive default.
const pdfConnectPolicy = (await readFile('docker/Caddyfile', 'utf8')).match(/connect-src [^;]+;/)[0];
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(suites)) {
  if (!suites[name]) throw Error('Unknown fixture suite: ' + name);
  const localApiPort = name === 'messenger-group-sharing-ui' ? 5229 : name === 'media-group-filter' ? 5230 : null;
  const server = name === 'messenger-notifications-ui' ? null : ['public-previews', 'public-consumption', 'video-player-recovery', 'media-double-tap'].includes(name) ? await createPublicPreviewServer() : await createServer({ configFile: false, root: process.cwd(), plugins: [
    // Keep the PDF fixture offline. A pending remote @import delays the entire
    // utility stylesheet in WebKit, including PDF.js's required absolute host.
    // Strip only the optional font import; retain every layout rule and CSP.
    ...(name === 'pdf-preview' ? [{ name: 'pdf-fixture-local-fonts', enforce: 'pre', transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/index.css')) {
        return code.replace(/@import\s+url\(['"]https:\/\/fonts\.googleapis\.com\/[^'"]+['"]\)\s*(?:layer\([^)]*\)\s*)?;/g, '');
      }
    } }] : []),
    react(),
  ], envPrefix: [],
    resolve: { alias: { '@': path.resolve('src') } },
    ...(name === 'pdf-preview' || name === 'file-previews' ? { optimizeDeps: { include: ['pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/legacy/web/pdf_viewer.mjs'] } } : {}),
    // Match production's same-origin proxy for the group lifecycle fixture.
    // WebKit otherwise reports navigation-aborted mocked CORS RPCs as page errors.
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(localApiPort ? `http://127.0.0.1:${localApiPort}` : `https://${suites[name]}.supabase.co`), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('isolated-fixture') },
    server: { host: '127.0.0.1', port: localApiPort ?? 0, strictPort: localApiPort !== null,
      ...(name === 'pdf-preview' ? { headers: { 'Content-Security-Policy': pdfConnectPolicy } } : {}) },
  });
  try {
    await server?.listen();
    // WebKit may reset an idle loopback socket when closing a fixture page.
    // Keep genuine server failures fatal; UI/API assertions still verify every
    // filter request. Notification fixtures handle these disconnects likewise.
    if (localApiPort) server?.httpServer.on('connection', socket => socket.on('error', cause => {
      if (!['ECONNRESET', 'EPIPE'].includes(cause.code)) throw cause;
    }));
    const port = server?.httpServer.address().port;
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['tests/' + name + '.mjs'], { stdio: 'inherit', env: { ...process.env, TEST_BASE_URL: `http://127.0.0.1:${port}` } });
      child.on('error', reject); child.on('exit', resolve);
    });
    if (status !== 0) throw Error(name + ' failed: ' + status);
  } finally { await server?.close(); }
}
