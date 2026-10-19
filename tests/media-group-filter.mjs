import assert from 'node:assert/strict';
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' ? { channel: process.env.BROWSER_CHANNEL || 'msedge' } : {}) });
const base = process.env.TEST_BASE_URL;
const family = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', work = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const publicId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', familyId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', workId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
try {
 for (const width of [1440, 390]) {
  // This fixture intercepts API requests, not notifications. WebKit cannot
  // reliably intercept requests once the unrelated notification worker controls
  // a document; worker behavior has its own real-HTTP regression suite.
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 1024, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let groups = [{ id: family, name: 'Family' }, { id: work, name: 'Work' }], fail = false, empty = false, delayed = false, release, received;
  let groupRequests = 0;
  await page.route('**/*', async route => {
   const requestUrl = new URL(route.request().url());
   if (requestUrl.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
   if (requestUrl.origin === new URL(base).origin && !/^\/(rest|storage|functions|auth)\/v1\//.test(requestUrl.pathname)) return route.continue();
   const url = new URL(route.request().url()), rpc = url.pathname.split('/').at(-1), body = route.request().postDataJSON() || {};
   const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Apikey, Content-Type, X-Client-Info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
   const respond = options => route.fulfill({ ...options, headers: cors });
   if (route.request().method() === 'OPTIONS') return respond({ status: 204, body: '' });
   if (rpc === 'is_admin') return respond({ json: false });
   if (rpc === 'media_filter_groups') return respond({ json: groups });
   if (rpc === 'group_media_ids') {
    groupRequests++;
    if (delayed && body.p_group === family) { received?.(); await new Promise(resolve => release = resolve); }
    if (fail) return respond({ status: 403, json: { code: '42501', message: 'Group unavailable' } });
    return respond({ json: empty ? [] : [body.p_group === family ? familyId : workId] });
   }
   if (rpc === 'videos' || rpc === 'photos') {
    const id = url.searchParams.get('visibility') === 'eq.public' ? publicId : url.searchParams.get('id')?.includes(familyId) ? familyId : workId;
    return respond({ json: [{ id, owner_id: '99999999-9999-4999-8999-999999999999', file_name: `${id === publicId ? 'Public' : id === familyId ? 'Family' : 'Work'} ${rpc === 'videos' ? 'video.mp4' : 'photo.jpg'}`, visibility: id === publicId ? 'public' : 'private', processing_status: 'ready', storage_path: '', preview_path: '', created_at: '2026-10-19T00:00:00Z' }] });
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
  groups = [{ id: work, name: 'Work' }];
  await page.evaluate(() => window.dispatchEvent(new Event('media-access-changed')));
  await expectTitles(['Public video.mp4']);
  assert.equal(await select.inputValue(), ''); assert.deepEqual(await select.locator('option').allTextContents(), ['NONE', 'Work']);
  console.log(`PASS ${engine} ${width}px late response ignored, failed/empty filter never falls back, retry, removed group resets NONE`);
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
