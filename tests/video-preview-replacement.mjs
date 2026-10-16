// Real capture, decoding, validation and confirmation. API/storage writes stay
// in this fixture; no production media or saved previews are touched.
import assert from 'node:assert/strict';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const base = process.env.TEST_BASE_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const owner = '11111111-1111-4111-8111-111111111111', videoId = '22222222-2222-4222-8222-222222222222';
const oldPath = owner + '/video-previews/old.webp', newPath = owner + '/video-previews/replacement.webp';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQqDjxHwAEnAJobhvlygAAAABJRU5ErkJggg==', 'base64');
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + engine + ' ' + label); };
async function fixture(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: engine !== 'firefox' && width < 1024 });
  const page = await context.newPage(), errors = [];
  const state = { uploads: 0, queues: 0, updates: 0, removals: [], preview: oldPath, failUpload: false };
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.dataFetches = 0;
    window.previewUploadBodies = [];
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      if (body instanceof Blob) window.previewUploadBodies.push(body);
      return send.call(this, body);
    };
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('data:')) window.dataFetches++;
      return original(input, init);
    };
  });
  await page.route('https://upload-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (path.endsWith('/rpc/get_storage_base_path')) return route.fulfill({ json: 'configured-images' });
    if (path.endsWith('/functions/v1/serve-media')) return route.fulfill({ json: { url: base + `/tests/fixtures/playback-ended.${engine === 'webkit' ? 'mp4' : 'webm'}` } });
    if (path.includes('/storage/v1/object/sign/')) {
      if (request.method() === 'POST') return route.fulfill({ json: { signedURL: '/object/sign/user-images/' + oldPath + '?token=fixture' } });
      return route.fulfill({ contentType: 'image/png', body: png });
    }
    if (path.includes('/storage/v1/object/media-staging/')) {
      state.uploads++;
      assert.equal(request.headers().authorization, 'Bearer fixture');
      // WebKit's routing protocol omits Blob request bodies. Read the exact
      // Blob passed to the real XHR send instead of assuming an empty upload.
      const body = await page.evaluate(async () => {
        const blob = window.previewUploadBodies.at(-1);
        return { size: blob.size, bytes: Array.from(new Uint8Array(await blob.slice(0, 8).arrayBuffer())) };
      });
      assert.ok(body.size > 0);
      assert.ok(body.bytes[0] === 255 && body.bytes[1] === 216 || body.bytes[0] === 137 && body.bytes[1] === 80 || Buffer.from(body.bytes).subarray(0, 4).toString() === 'RIFF', 'captured JPEG or selected JPEG/PNG/WebP bytes');
      if (state.failUpload) return route.fulfill({ status: 503, json: { message: 'Fixture unavailable' } });
      return route.fulfill({ json: { Key: 'media-staging/' + owner + '/source' } });
    }
    if (path.endsWith('/functions/v1/queue-media-upload')) {
      const body = request.postDataJSON(); state.queues++;
      assert.equal(body.kind, 'preview'); assert.equal(body.target_video_id, videoId);
      assert.ok(state.uploads > 0); return route.fulfill({ status: 202, json: { id: body.id, status: 'queued' } });
    }
    if (path.endsWith('/media_upload_jobs')) return route.fulfill({ json: { status: 'complete', error: null, result: { path: newPath } } });
    if (path.endsWith('/videos') && request.method() === 'PATCH') {
      const body = request.postDataJSON(); state.updates++;
      assert.equal(body.preview_path, newPath); assert.equal(body.preview_url, null);
      assert.equal(body.visibility, 'private'); assert.equal(state.removals.length, 0);
      assert.equal(state.queues, 1); state.preview = body.preview_path;
      return route.fulfill({ json: { id: videoId } });
    }
    if (path.endsWith('/storage/v1/object/user-images') && request.method() === 'DELETE') {
      assert.equal(state.preview, newPath, 'only clean up after new preview is saved');
      state.removals.push(...request.postDataJSON().prefixes);
      return route.fulfill({ json: [] });
    }
    throw Error('Unexpected fixture request: ' + request.method() + ' ' + path);
  });
  await page.goto(base + '/tests/video-preview-replacement.html');
  await page.getByRole('dialog', { name: 'Edit video', exact: true }).waitFor();
  return { page, context, state, errors };
}
async function capture(page) {
  await page.getByRole('button', { name: 'Capture from video', exact: true }).click();
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0; });
  await page.getByRole('button', { name: 'Capture current frame', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('img[alt="Preview"]')?.src.startsWith('data:image/jpeg'));
}
async function choosePicture(page, format = 'png') {
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/' + format;
  const buffer = format === 'png' ? png : Buffer.from(await page.evaluate(mime => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16);
    const result = canvas.toDataURL(mime);
    if (!result.startsWith('data:' + mime + ';base64,')) throw Error('Fixture encoder unavailable: ' + mime);
    return result.split(',')[1];
  }, mimeType), 'base64');
  const [picker] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload image', exact: true }).click(),
  ]);
  await picker.setFiles({ name: 'replacement.' + format, mimeType, buffer });
  await page.waitForFunction(mime => document.querySelector('img[alt="Preview"]')?.src.startsWith('data:' + mime), mimeType);
}
async function confirm(page) {
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('heading', { name: 'Replace preview image', exact: true }).waitFor();
  return dialog;
}
async function saved(page) {
  await page.waitForFunction(() => document.querySelector('[data-preview-saved="1"]') || document.querySelector('[role="alertdialog"] [role="alert"]'), null, { timeout: 7000 });
  const error = page.getByRole('alertdialog').getByRole('alert');
  assert.equal(await error.count(), 0, await error.count() ? await error.innerText() : '');
  assert.equal(await page.getByRole('alertdialog').count(), 0);
  assert.ok(await page.getByText('Preview saved', { exact: true }).isVisible());
}
try {
  for (const width of [1440, 390]) {
    const { page, context, state, errors } = await fixture(width);
    await capture(page);
    let dialog = await confirm(page);
    assert.equal(state.uploads, 0); assert.equal(state.updates, 0); assert.equal(state.removals.length, 0);
    await page.mouse.click(2, 2); await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible());
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(state.preview, oldPath); assert.equal(state.uploads, 0);
    dialog = await confirm(page);
    await dialog.getByRole('button', { name: 'Replace preview', exact: true }).evaluate(button => { button.click(); button.click(); });
    await saved(page);
    assert.equal(state.uploads, 1); assert.equal(state.queues, 1); assert.equal(state.updates, 1);
    assert.deepEqual(state.removals, ['configured-images/' + oldPath]);
    assert.equal(await page.evaluate(() => window.dataFetches), 0);
    assert.deepEqual(errors, []);
    pass(width + 'px: real captured frame replaces preview under production connect-src; confirmation/Cancel/duplicate guard and old-preview cleanup');
    // Confirm the policy still blocks data: fetches: the fix must not relax CSP.
    assert.equal(await page.evaluate(async () => { try { await fetch('data:image/png;base64,AA=='); return false; } catch { return true; } }), true);
    pass(width + 'px: data: fetch remains blocked while local conversion succeeds');
    await context.close();
  }
  for (const fromPicture of [false, true]) {
    const { page, context, state } = await fixture(390);
    if (fromPicture) await choosePicture(page); else await capture(page);
    state.failUpload = true;
    const dialog = await confirm(page);
    await dialog.getByRole('button', { name: 'Replace preview', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.match(await dialog.getByRole('alert').innerText(), /unavailable.*503/);
    assert.equal(state.preview, oldPath); assert.equal(state.updates, 0); assert.equal(state.removals.length, 0);
    assert.ok(await dialog.getByRole('button', { name: 'Replace preview', exact: true }).isEnabled());
    state.failUpload = false;
    await dialog.getByRole('button', { name: 'Replace preview', exact: true }).click();
    await saved(page);
    assert.equal(state.uploads, 2); assert.equal(state.queues, 1); assert.equal(state.updates, 1);
    pass((fromPicture ? 'From picture' : 'Captured frame') + ': failed upload preserves original preview and draft; retry succeeds in the same confirmation');
    await context.close();
  }
  for (const format of ['png', 'jpg', 'webp']) {
    const { page, context, state } = await fixture(390);
    await choosePicture(page, format);
    let dialog = await confirm(page);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(state.uploads, 0); assert.equal(state.updates, 0); assert.deepEqual(state.removals, []);
    assert.equal(state.preview, oldPath);
    dialog = await confirm(page);
    await dialog.getByRole('button', { name: 'Replace preview', exact: true }).evaluate(button => { button.click(); button.click(); });
    await saved(page);
    assert.equal(state.uploads, 1); assert.equal(state.queues, 1); assert.equal(state.updates, 1);
    assert.deepEqual(state.removals, ['configured-images/' + oldPath]);
    assert.equal(await page.evaluate(() => window.dataFetches), 0);
    pass('From picture ' + format.toUpperCase() + ': button opens picker, preview loads, Cancel preserves original, confirmed save succeeds once under CSP');
    await context.close();
  }
  console.log(checks + ' preview replacement browser checks passed');
} finally { await browser.close(); }
