import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' ? { channel: process.env.BROWSER_CHANNEL || 'msedge' } : {}) });
const base = process.env.TEST_BASE_URL;
const family = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', work = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const publicId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', familyId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', workId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const videoFile = { name: 'Uploaded video.mp4', mimeType: 'video/mp4', buffer: readFileSync('tests/fixtures/media-valid.mp4') };
const photoFile = { name: 'Uploaded photo.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/media-valid.jpg') };
try {
 for (const width of [1440, 390]) {
  // This fixture intercepts API requests, not notifications. WebKit cannot
  // reliably intercept requests once the unrelated notification worker controls
  // a document; worker behavior has its own real-HTTP regression suite.
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 1024, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let groups = [{ id: family, name: 'Family' }, { id: work, name: 'Work' }], fail = false, empty = false, delayed = false, release, received;
  let groupRequests = 0;
  const uploads = [];
  await page.route('**/*', async route => {
   const requestUrl = new URL(route.request().url());
   if (requestUrl.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
   if (requestUrl.origin === new URL(base).origin && !/^\/(rest|storage|functions|auth)\/v1\//.test(requestUrl.pathname)) return route.continue();
   const url = new URL(route.request().url()), rpc = url.pathname.split('/').at(-1), body = route.request().headers()['content-type']?.includes('application/json') ? route.request().postDataJSON() || {} : {};
   const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Apikey, Content-Type, X-Client-Info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
   const respond = options => route.fulfill({ ...options, headers: cors });
   if (route.request().method() === 'OPTIONS') return respond({ status: 204, body: '' });
   if (rpc === 'is_admin') return respond({ json: false });
   if (rpc === 'media_filter_groups') return respond({ json: groups });
   if (rpc === 'queue-media-upload') {
    if (body.group_id && !groups.some(g => g.id === body.group_id)) return respond({ status: 409, json: { error: 'Group unavailable. You must be a current member to upload.' } });
    uploads.push({ ...body, status: body.kind === 'video' ? 'queued' : 'complete' });
    return respond({ status: 202, json: { id: body.id, status: 'queued' } });
   }
   if (url.pathname.includes('/storage/v1/')) return respond({ json: { Key: url.pathname } });
   if (rpc === 'media_upload_jobs') {
    if (url.searchParams.has('id')) return respond({ json: uploads.find(job => 'eq.' + job.id === url.searchParams.get('id')) });
    const status = url.searchParams.get('status') ?? '';
    return respond({ json: uploads.filter(job => job.kind === 'video' && (!url.searchParams.has('upload_group_id') || 'eq.' + job.group_id === url.searchParams.get('upload_group_id')) && status.includes(job.status)).map(job => ({ ...job, error: null, visibility: 'private' })) });
   }
   if (rpc === 'group_media_ids') {
    groupRequests++;
    if (delayed && body.p_group === family) { received?.(); await new Promise(resolve => release = resolve); }
    if (fail) return respond({ status: 403, json: { code: '42501', message: 'Group unavailable' } });
    return respond({ json: empty ? [] : [body.p_group === family ? familyId : workId, ...uploads.filter(job => job.status === 'complete' && job.group_id === body.p_group && job.kind === body.p_type).map(job => job.id)] });
   }
   if (rpc === 'videos' || rpc === 'photos') {
    const id = url.searchParams.get('visibility') === 'eq.public' ? publicId : url.searchParams.get('id')?.includes(familyId) ? familyId : workId;
    const extra = uploads.filter(job => job.status === 'complete' && job.kind === (rpc === 'videos' ? 'video' : 'photo') && url.searchParams.get('id')?.includes(job.id));
    return respond({ json: [{ id, file_name: `${id === publicId ? 'Public' : id === familyId ? 'Family' : 'Work'} ${rpc === 'videos' ? 'video.mp4' : 'photo.jpg'}` }, ...extra].map(row => ({ ...row, owner_id: '99999999-9999-4999-8999-999999999999', visibility: row.id === publicId ? 'public' : 'private', processing_status: 'ready', storage_path: '', preview_path: '', created_at: '2026-10-19T00:00:00Z' })) });
   }
   if (rpc === 'messenger_rpc') return respond({ json: body.p_action === 'inbox' ? { conversations: [], unread: 0 } : {} });
   return respond({ json: [] });
  });
  await page.goto(`${base}/tests/public-navigation.html`);
  const menu = page.locator('aside');
  const select = page.getByLabel('Messenger group', { exact: true });
  const titles = () => page.locator('.mg-grid .mg-title').allTextContents();
  const choose = async id => {
   if (width < 1024) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
   await select.selectOption(id);
   if (width < 1024) assert.ok((await menu.getAttribute('class')).includes('-translate-x-full'));
  };
  const expectTitles = async expected => {
   try { await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.mg-grid .mg-title')].map(n => n.textContent)) === JSON.stringify(expected), expected); }
   catch (error) { console.error({ expected, actual: await titles(), alerts: await page.getByRole('alert').allTextContents(), errors }); throw error; }
  };
  await expectTitles(['Public video.mp4']);
  await page.waitForFunction(() => document.querySelector('#media-group-filter')?.options.length === 3);
  assert.deepEqual(await select.locator('option').allTextContents(), ['NONE', 'Family', 'Work']);
  assert.equal(await select.inputValue(), '');
  await choose(family); await expectTitles(['Family video.mp4']);
  await page.getByRole('navigation', { name: 'Media navigation' }).getByRole('button', { name: 'Photos', exact: true }).click();
  await expectTitles(['Family photo.jpg']); assert.equal(await select.inputValue(), family);
  assert.equal(await page.locator('.mg-privacy').innerText(), 'Private');
  await choose(work); await expectTitles(['Work photo.jpg']);
  await choose(''); await expectTitles(['Public photo.jpg']);
  assert.equal(await page.locator('.mg-privacy').innerText(), 'Public');
  console.log(`PASS ${engine} ${width}px NONE/public, exact group videos/photos, persistent selection across tabs, privacy label, mobile drawer`);
  await page.getByRole('navigation', { name: 'Media navigation' }).getByRole('button', { name: 'Videos', exact: true }).click();
  await expectTitles(['Public video.mp4']);
  delayed = true;
  const requested = new Promise(resolve => received = resolve);
  await choose(family); await requested;
  await choose(work); await expectTitles(['Work video.mp4']);
  delayed = false; release();
  await page.waitForLoadState('networkidle'); assert.deepEqual(await titles(), ['Work video.mp4']);
  fail = true; await choose(family);
  await page.getByRole('alert').filter({ hasText: 'Could not load group videos' }).waitFor();
  assert.deepEqual(await titles(), [], 'failure must not leave old group content or fall back to public');
  fail = false; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expectTitles(['Family video.mp4']);
  await page.screenshot({ path: `.runtime/media-group-filter-${engine}-${width}.png` });
  empty = true; await choose(work);
  await page.getByText('No videos shared with this group yet', { exact: true }).waitFor();
  assert.deepEqual(await titles(), []); empty = false; await choose(family); await expectTitles(['Family video.mp4']);
  const videoRoute = new URL(page.url()).hash;
  await page.getByRole('button', { name: 'Upload video', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Upload video', exact: true });
  await dialog.getByText('Upload to group:', { exact: false }).waitFor();
  assert.match(await dialog.innerText(), /Family/); assert.equal(await dialog.getByRole('button', { name: 'Public', exact: true }).count(), 0);
  await dialog.locator('input[type=file]').first().setInputFiles(videoFile);
  await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
  await dialog.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await dialog.waitFor({ state: 'hidden' }); assert.equal(uploads.length, 1); assert.equal(uploads[0].group_id, family); assert.equal(uploads[0].visibility, 'private');
  await page.locator(`[data-upload-id="${uploads[0].id}"]`).waitFor();
  uploads[0].status = 'complete'; await page.evaluate(() => window.dispatchEvent(new Event('media-processing')));
  await expectTitles(['Family video.mp4', 'Uploaded video']);
  assert.equal(await select.inputValue(), family); assert.equal(new URL(page.url()).hash, videoRoute, 'group upload must not redirect to My Videos');
  const drop = async files => page.locator('.media-drop').evaluate((element, files) => {
   const transfer = new DataTransfer(); for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
   element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, files.map(file => ({ name: file.name, type: file.mimeType, bytes: [...file.buffer] })));
  await drop([{ ...videoFile, name: 'Batch one.mp4' }, { ...videoFile, name: 'Batch two.mp4' }]);
  dialog = page.getByRole('dialog', { name: 'Upload videos', exact: true });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(uploads.length, 3); assert.ok(uploads.every(job => job.group_id === family && job.visibility === 'private'));
  assert.equal(new URL(page.url()).hash, videoRoute);
  await page.getByRole('navigation', { name: 'Media navigation' }).getByRole('button', { name: 'Photos', exact: true }).click();
  await expectTitles(['Family photo.jpg']);
  if (width < 1024) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await menu.getByRole('button', { name: 'Upload photos', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Upload photos', exact: true });
  await dialog.locator('input[type=file]').setInputFiles(photoFile); await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' }); await expectTitles(['Family photo.jpg', 'Uploaded photo']);
  assert.equal(new URL(page.url()).hash, '#/public-photos'); assert.equal(await select.inputValue(), family);
  await page.getByRole('button', { name: 'Upload photo', exact: true }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles([{ ...photoFile, name: 'Batch photo one.jpg' }, { ...photoFile, name: 'Batch photo two.jpg' }]);
  dialog = page.getByRole('dialog', { name: 'Upload photos', exact: true });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(uploads.length, 6); assert.ok(uploads.every(job => job.group_id === family && job.visibility === 'private'));
  await page.screenshot({ path: `.runtime/group-uploads-${engine}-${width}.png` });
  console.log(`PASS ${engine} ${width}px group header/sidebar/picker/drop uploads, private single and batch videos/photos, duplicate submit guard, processing completion refresh, no personal redirect`);
  await page.getByRole('button', { name: 'Upload photo', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Upload photos', exact: true });
  await dialog.locator('input[type=file]').setInputFiles(photoFile);
  groups = [{ id: work, name: 'Work' }];
  await page.evaluate(() => window.dispatchEvent(new Event('media-access-changed')));
  await page.waitForFunction(() => document.querySelector('#media-group-filter')?.value === '');
  assert.match(await dialog.innerText(), /Upload to group: Family/);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await dialog.getByText('Group unavailable.', { exact: false }).waitFor(); assert.equal(uploads.length, 6);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('navigation', { name: 'Media navigation' }).getByRole('button', { name: 'Videos', exact: true }).click();
  await expectTitles(['Public video.mp4']);
  assert.equal(await select.inputValue(), ''); assert.deepEqual(await select.locator('option').allTextContents(), ['NONE', 'Work']);
  console.log(`PASS ${engine} ${width}px late response ignored, failed/empty filter never falls back, retry, removed group resets NONE`);
  await page.getByRole('button', { name: 'Upload video', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Upload video', exact: true });
  assert.equal(await dialog.getByText('Upload to group:', { exact: false }).count(), 0);
  await dialog.locator('input[type=file]').first().setInputFiles(videoFile); await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('heading', { name: 'My Videos', exact: true }).waitFor(); assert.equal(uploads.at(-1).group_id, undefined);
  console.log(`PASS ${engine} ${width}px captured destination survives membership refresh; rejection stays in form; NONE preserves personal upload behavior`);
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-unmount'))); await page.waitForLoadState('networkidle');
  assert.deepEqual(errors, []); assert.ok(groupRequests >= 6); await page.close();
 }
 const guest = await browser.newPage({ serviceWorkers: 'block' }); let guestGroupRequests = 0;
 await guest.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(base).origin && !/^\/(rest|storage|functions|auth)\/v1\//.test(url.pathname)) return route.continue();
  if (url.pathname.endsWith('media_filter_groups')) guestGroupRequests++;
  if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
  return route.fulfill({ json: [] });
 });
 await guest.goto(`${base}/tests/public-navigation.html?guest`);
 await guest.getByRole('heading', { name: 'Discover videos', exact: true }).waitFor();
 assert.equal(await guest.getByLabel('Messenger group', { exact: true }).count(), 0); assert.equal(guestGroupRequests, 0);
 await guest.evaluate(() => window.dispatchEvent(new Event('fixture-unmount'))); await guest.waitForLoadState('networkidle');
 await guest.close(); console.log(`PASS ${engine} guests retain public discovery without group enumeration`);
} finally { await browser.close(); }
