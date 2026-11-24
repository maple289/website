// Local fixture only. Native OS gestures are represented by browser entry APIs.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';
const base = process.env.TEST_BASE_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const engine = process.env.TEST_BROWSER || process.env.BROWSER_ENGINE || 'chromium';
const type = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium;
const channel = engine === 'edge' ? 'msedge' : engine === 'chrome' ? 'chrome' : engine === 'chromium' ? process.env.BROWSER_CHANNEL : undefined;
const browser = await type.launch({ headless: true, ...(channel ? { channel } : {}) });
const temp = await mkdtemp(path.join(os.tmpdir(), 'myhostage-folders-'));
const owner = '11111111-1111-4111-8111-111111111111';
const picked = path.join(temp, 'Folder with spaces');
await mkdir(path.join(picked, 'Deep'), { recursive: true });
await writeFile(path.join(picked, 'Deep', 'README'), 'nested payload');
await writeFile(path.join(picked, 'é & 文件.txt'), 'unicode payload');
try {
 for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(() => { Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, writable: true, value: undefined }); });
  const page = await context.newPage(), entries = new Map(), errors = [], payloads = new Map(), resumable = new Map();
  let rejectName = '';
  const uploadServer = createServer(async (request, response) => {
   response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
   response.setHeader('Access-Control-Allow-Methods', '*'); response.setHeader('Access-Control-Expose-Headers', 'Location,Upload-Offset,Tus-Resumable');
   if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
   const chunks = []; for await (const chunk of request) chunks.push(chunk);
   if (request.url.includes('/upload/resumable')) {
    response.setHeader('Tus-Resumable', '1.0.0');
    let id = request.url.split('/').at(-1), item;
    if (request.method === 'POST') {
     id = String(resumable.size + 1);
     const metadata = Object.fromEntries(request.headers['upload-metadata'].split(',').map(pair => { const [key, value] = pair.split(' '); return [key, Buffer.from(value, 'base64').toString()]; }));
     item = { path: metadata.objectName.replace('/files/', '/'), size: Number(request.headers['upload-length']), chunks: [] };
     resumable.set(id, item);
     response.setHeader('Location', 'http://127.0.0.1:' + uploadServer.address().port + '/storage/v1/upload/resumable/' + id);
    } else item = resumable.get(id);
    item.chunks.push(...chunks);
    const payload = Buffer.concat(item.chunks); response.setHeader('Upload-Offset', String(payload.length));
    if (payload.length === item.size) { entries.set(item.path, { folder: false, size: payload.length }); payloads.set(item.path, payload); }
    response.writeHead(request.method === 'POST' ? 201 : 204); response.end(); return;
   }
   const physical = decodeURIComponent(request.url.split('/users/')[1]);
   const p = physical.replace('/files/', '/');
   assert.equal(request.headers['x-upsert'], 'false');
   if (p.endsWith('/' + rejectName) || entries.has(p)) { response.writeHead(413); response.end('{}'); return; }
   const payload = Buffer.concat(chunks); payloads.set(p, payload); entries.set(p, { folder: false, size: payload.length });
   if (p.endsWith('/ambiguous')) { response.destroy(); return; }
   response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ Key: physical }));
  });
  await new Promise(resolve => uploadServer.listen(0, '127.0.0.1', resolve));
  await context.addInitScript(port => {
   const open = XMLHttpRequest.prototype.open;
   XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (String(url).includes('/storage/v1/object/users/') || String(url).includes('/storage/v1/upload/resumable')) url = 'http://127.0.0.1:' + port + new URL(url).pathname;
    return open.call(this, method, url, ...rest);
   };
  }, uploadServer.address().port);
  page.on('pageerror', error => errors.push(error.message));
  const now = new Date().toISOString();
  const meta = () => [...entries].map(([object_path, item]) => ({ object_path, owner_id: owner, is_folder: item.folder, file_size: item.size, mime_type: '', updated_at: now, created_at: now, trashed_at: null }));
  await page.route('https://upload-test.supabase.co/**', async route => {
   const request = route.request(), url = new URL(request.url());
   if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
   const body = () => request.postDataJSON();
   if (url.pathname.endsWith('/rpc/create_user_file_folder')) {
    const p = body().p_path;
    if (p.endsWith('/' + rejectName) || entries.has(p)) return route.fulfill({ status: 409, json: { message: 'Folder conflict' } });
    entries.set(p, { folder: true, size: 0 }); return route.fulfill({ json: null });
   }
   if (url.pathname.endsWith('/rpc/resolve_user_file_location')) return route.fulfill({ json: { bucket: 'users', path: body().p_path.replace(owner + '/', owner + '/files/'), id: null } });
   if (url.pathname.endsWith('/rpc/file_manager_objects')) {
    const prefix = body().p_folder + '/';
    const children = [...entries].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(([p, item]) => ({ name: p.slice(prefix.length), id: item.folder ? null : p, metadata: { size: item.size }, updated_at: now }));
    return route.fulfill({ json: children.slice(body().p_offset ?? 0, (body().p_offset ?? 0) + (body().p_limit ?? 100)) });
   }
   if (url.pathname.endsWith('/rpc/file_manager_metadata') || url.pathname.includes('/rest/v1/user_file_metadata')) return route.fulfill({ json: meta() });
   if (url.pathname.endsWith('/rpc/file_manager_storage_bytes')) return route.fulfill({ json: [...entries.values()].reduce((sum, item) => sum + item.size, 0) });
   return route.fulfill({ json: [] });
  });
  await page.goto(base + '/tests/file-integrity.html');
  await page.getByText('This folder is empty', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const chooserPending = page.waitForEvent('filechooser');
  await page.getByRole('dialog', { name: 'Upload files' }).getByRole('button', { name: 'Add Folder', exact: true }).click();
  const chooser = await chooserPending;
  assert.equal(await chooser.element().getAttribute('aria-label'), 'Select folder for upload');
  assert.equal(await chooser.element().evaluate(input => !!input.closest('[role="dialog"]') && !input.closest('[inert]')), true, 'Folder chooser must belong to the active modal');
  await chooser.setFiles(picked);
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await dialog.getByText(/Upload complete/).waitFor();
  assert.equal(entries.size, 4); assert.equal(payloads.size, 2);
  assert.equal(entries.get(owner + '/Folder with spaces/Deep').folder, true);
  assert.equal(createHash('sha256').update(payloads.get(owner + '/Folder with spaces/Deep/README')).digest('hex'), createHash('sha256').update('nested payload').digest('hex'));
  assert.match(await dialog.innerText(), /Empty folders are not included/);
  await mkdir('output/folder-uploads', { recursive: true });
  await page.screenshot({ path: `output/folder-uploads/${engine}-${width}.png` });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => { window.showDirectoryPicker = () => { throw new Error('Directory discovery denied'); }; });
  await page.getByRole('button', { name: 'Add Folder', exact: true }).click();
  await dialog.getByText('Directory discovery denied', { exact: true }).waitFor();
  assert.ok(!(await dialog.innerText()).includes('Upload complete'));
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => { window.showDirectoryPicker = undefined; });
  await page.getByText('Folder with spaces', { exact: true }).dblclick();
  await page.getByText('Deep', { exact: true }).waitFor();
  await page.reload(); await page.getByText('Deep', { exact: true }).waitFor();
  // Mixed folder/file drop into the nested destination, with an empty directory.
  await page.locator('.fm-drop-area').evaluate(element => {
   const leaf = name => ({ name, isFile: true, isDirectory: false, file: ok => ok(new File(['drop payload'], name)) });
   const dir = (name, children = []) => ({ name, isFile: false, isDirectory: true, createReader: () => { let done = false; return { readEntries: ok => { ok(done ? [] : children); done = true; } }; } });
   const roots = [dir('Dropped', [dir('Empty'), dir('Nested', [leaf('no-extension')])]), dir('Second'), leaf('loose')];
   const dataTransfer = { types: ['Files'], items: roots.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null })) };
   const event = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: dataTransfer }); element.dispatchEvent(event);
  });
  await dialog.getByText(/Upload complete/).waitFor();
  const destination = owner + '/Folder with spaces/';
  assert.ok(entries.get(destination + 'Dropped/Empty').folder);
  assert.equal(payloads.get(destination + 'Dropped/Nested/no-extension').toString(), 'drop payload');
  assert.ok(entries.has(destination + 'Second'));
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  // A duplicate selected root must leave all existing records and bytes intact.
  const before = entries.size;
  await page.getByRole('button', { name: 'Back to My Files', exact: true }).click();
  await page.getByText('Folder with spaces', { exact: true }).waitFor();
  await page.getByLabel('Select folder', { exact: true }).setInputFiles(picked);
  await dialog.getByText(/Incomplete/).waitFor();
  await dialog.locator('button:not(:disabled)').filter({ hasText: /^Done$/ }).waitFor();
  assert.equal(entries.size, before);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  rejectName = 'denied';
  await page.locator('input[type=file]:not([webkitdirectory])').first().setInputFiles([{ name: 'denied', mimeType: 'text/plain', buffer: Buffer.from('failed') }, { name: 'ambiguous', mimeType: 'text/plain', buffer: Buffer.from('committed before response lost') }, { name: 'okay', mimeType: 'text/plain', buffer: Buffer.from('success') }]);
  await dialog.locator('button:not(:disabled)').filter({ hasText: /^Done$/ }).waitFor();
  assert.match(await dialog.innerText(), /Incomplete/); assert.ok(!entries.has(owner + '/denied')); assert.ok(entries.has(owner + '/okay'), JSON.stringify({ paths: [...entries.keys()], text: await dialog.innerText() }));
  assert.equal(payloads.get(owner + '/ambiguous').toString(), 'committed before response lost');
  await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible());
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  // Native handle discovery preserves even a completely empty selected folder.
  await page.evaluate(() => { window.showDirectoryPicker = async () => ({ kind: 'directory', name: 'Native folder', async *values() { yield { kind: 'directory', name: 'Empty', async *values() {} }; } }); });
  await page.getByRole('button', { name: 'Add Folder', exact: true }).click();
  await dialog.getByText('Native folder/Empty', { exact: true }).waitFor();
  await dialog.locator('button:not(:disabled)').filter({ hasText: /^Done$/ }).waitFor();
  assert.ok(entries.get(owner + '/Native folder/Empty').folder);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const large = Buffer.alloc(7 * 1024 * 1024, 37);
  await page.getByText('Native folder', { exact: true }).dblclick();
  await page.getByText('Empty', { exact: true }).waitFor();
  await page.locator('input[type=file]:not([webkitdirectory])').first().setInputFiles({ name: 'large.bin', mimeType: 'application/octet-stream', buffer: large });
  await dialog.getByText('large.bin', { exact: true }).waitFor();
  await dialog.locator('button:not(:disabled)').filter({ hasText: /^Done$/ }).waitFor();
  assert.equal(createHash('sha256').update(payloads.get(owner + '/Native folder/large.bin')).digest('hex'), createHash('sha256').update(large).digest('hex'));
  assert.deepEqual(errors, []);
  console.log(`PASS ${engine} ${width}px: folder selector, native handles, mixed recursive drop, empty folders, names, nested destination, refresh, small/7MiB TUS checksums, duplicates, quota error isolation, modal safety`);
  await context.close();
  await new Promise(resolve => uploadServer.close(resolve));
 }
} finally { await browser.close(); await rm(temp, { recursive: true, force: true }); }
