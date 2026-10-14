// Isolated real components, mocked APIs, and a three-second VP8 fixture. No
// production requests or mutations. Native Safari fullscreen is simulated.
import assert from 'node:assert/strict';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5217';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
try {
  for (const width of [1440, 390, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width !== 1440 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    // WebKit on Windows advertises VP8 but does not decode this fixture. Use
    // a three-second H.264 fixture for that engine; others use VP8 in CI.
    if (engine === 'webkit') await page.route('**/functions/v1/serve-media?*', route => route.fulfill({ json: { url: '/tests/fixtures/playback-ended.mp4' } }));
    const click = name => page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Video player', exact: true });
    const open = async (name = 'Public video') => {
      await click('Play ' + name);
      await page.waitForFunction(() => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false; v.pause(); return true; });
    };
    const runToEnd = async () => {
      await page.locator('video').evaluate(v => { v.currentTime = 0; });
      await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.seeking && v.currentTime < v.duration; });
      await page.locator('video').evaluate((v, rate) => { v.playbackRate = rate; void v.play().catch(error => { window.playbackError = error.message; }); }, engine === 'webkit' ? 1 : 4);
    };
    const closed = async () => {
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('video').count(), 0);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
      assert.equal(await page.locator('[inert]').count(), 0);
    };
    await page.goto(base + '/tests/public-previews.html?consumption=1');
    await page.getByRole('img', { name: 'Public video', exact: true }).waitFor();
    assert.equal(await page.locator('.content-menu-trigger').count(), 0);
    await page.reload(); await page.getByRole('img', { name: 'Public video', exact: true }).waitFor();
    assert.equal(await page.locator('.content-menu-trigger').count(), 0);
    await open();
    const galleryPosition = await page.evaluate(() => window.scrollY);
    assert.ok((await page.locator('video').getAttribute('controlslist')).split(' ').includes('nodownload'));
    await page.locator('video').evaluate(v => { v.dispatchEvent(new Event('waiting')); v.dispatchEvent(new Event('stalled')); v.dispatchEvent(new Event('error')); });
    await page.waitForTimeout(150);
    assert.ok(await dialog.isVisible(), 'pause/buffering/stall/error must not close');
    await page.locator('video').evaluate(v => { v.currentTime = v.duration / 2; });
    await page.waitForFunction(() => !document.querySelector('video')?.seeking);
    assert.ok(await dialog.isVisible(), 'seeking must not close');
    await page.locator('video').evaluate(v => { v.currentTime = v.duration; });
    await page.waitForFunction(() => !document.querySelector('video')?.seeking);
    // Safari automatically restarts playback if play() is called at the end.
    // Seeking itself must leave the paused player open.
    await page.waitForTimeout(150);
    assert.ok(await dialog.isVisible(), 'seeking directly to the end must not close');
    await page.locator('video').evaluate(v => {
      window.completedVideo = v; window.naturalEnds = 0;
      v.addEventListener('ended', () => window.naturalEnds++);
    });
    await runToEnd(); await closed();
    assert.equal(await page.evaluate(() => window.naturalEnds), 1);
    assert.equal(await page.evaluate(() => window.completedVideo.getAttribute('src')), null);
    assert.equal(await page.evaluate(() => window.completedVideo.paused), true);
    assert.equal(await page.evaluate(() => window.scrollY), galleryPosition);
    await open('Another public video'); await click('Close video player'); await closed();
    console.log(`PASS ${engine} ${width}px: anonymous video/refresh, natural ended, pause/stall/seek safety, released source, scroll/focus/inert cleanup, reopen/manual close`);

    await click('photos');
    await page.getByRole('img', { name: 'Public photo', exact: true }).waitFor();
    assert.equal(await page.locator('.content-menu-trigger').count(), 0);
    await click('Open Public photo');
    await page.getByRole('dialog', { name: 'Photo viewer' }).waitFor();
    await click('Close');
    await click('files'); await page.getByText('public-document.docx', { exact: true }).waitFor();
    assert.equal(await page.locator('.content-menu-trigger').count(), 0);
    assert.equal(await page.getByRole('button', { name: /^(Select|Select item)$/ }).count(), 0);
    await page.getByText('public-archive.zip', { exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0, 'unsupported file retains its icon');
    for (const layout of ['List view', 'Tree View', 'Grid view']) {
      await click(layout);
      assert.equal(await page.locator('.content-menu-trigger').count(), 0);
      assert.equal(await page.getByRole('button', { name: /^(Select|Select item)$/ }).count(), 0);
    }
    // Windows WebKit's native popup consumes a later automation click; exercise
    // its application context handler without opening the native popup.
    if (engine === 'webkit') await page.locator('.fm-card').first().dispatchEvent('contextmenu', { clientX: 100, clientY: 100 });
    else await page.locator('.fm-card').first().click({ button: 'right' });
    assert.equal(await page.getByRole('menu').count(), 0);
    await page.keyboard.press('Escape'); // Dismiss the browser's native context menu.
    await page.getByRole('button', { name: 'Preview public-document.docx', exact: true }).focus();
    await page.keyboard.press('Enter');
    const fileDialog = page.getByRole('dialog', { name: 'File preview', exact: true });
    await fileDialog.locator('.page[data-loaded="true"] canvas').first().waitFor();
    await fileDialog.getByText('Public generated preview', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Download original file' }).count(), 0);
    await click('Close preview');
    await fileDialog.waitFor({ state: 'hidden' });
    await click('Fixture sign in');
    await page.getByRole('button', { name: 'Actions for public-document.docx' }).click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Preview', 'Download']);
    await click('Fixture sign out');
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await page.locator('.content-menu-trigger').count(), 0);
    await click('videos'); await click('Fixture sign in');
    await page.getByRole('button', { name: 'Actions for Public video', exact: true }).click();
    const ownerActions = await page.getByRole('menuitem').allTextContents();
    for (const name of ['Edit', 'Rename', 'Share', 'Download', 'Delete', 'Make private']) assert.ok(ownerActions.includes(name));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Actions for Another public video', exact: true }).click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Play', 'Download']);
    assert.equal(await page.getByRole('button', { name: 'Actions for Processing public video' }).count(), 0);
    await click('Fixture sign out');
    assert.equal(await page.locator('.content-menu-trigger').count(), 0);
    console.log(`PASS ${engine} ${width}px: public photos/files, unsupported icon, no anonymous selection/download/context actions, owner/read-only permissions, empty menus, logout removes open menu`);

    if (engine === 'chromium' && width === 1440) {
      await open();
      await page.locator('video').evaluate(v => v.requestFullscreen());
      assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
      await runToEnd(); await closed();
      assert.equal(await page.evaluate(() => document.fullscreenElement), null);
      console.log('PASS actual desktop fullscreen: natural end exits fullscreen and restores gallery');
    }

    // Deterministic asynchronous standard/fullscreen and native iOS API exits.
    for (const native of [false, true]) {
      await open();
      await page.locator('video').evaluate((v, native) => {
        window.exitCalls = 0; window.fullscreenExited = false; window.presentDuringExit = false;
        if (native) {
          Object.defineProperty(v, 'webkitDisplayingFullscreen', { configurable: true, writable: true, value: true });
          v.webkitExitFullscreen = () => { window.exitCalls++; setTimeout(() => { window.presentDuringExit = v.isConnected; v.webkitDisplayingFullscreen = false; window.fullscreenExited = true; v.dispatchEvent(new Event('webkitendfullscreen')); }, 90); };
        } else {
          Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => window.fullscreenExited ? null : v });
          document.exitFullscreen = () => { window.exitCalls++; return new Promise(resolve => setTimeout(() => { window.presentDuringExit = v.isConnected; window.fullscreenExited = true; document.dispatchEvent(new Event('fullscreenchange')); resolve(); }, 90)); };
        }
      }, native);
      await runToEnd(); await closed();
      assert.equal(await page.evaluate(() => window.exitCalls), 1);
      await page.waitForFunction(() => window.fullscreenExited);
      assert.equal(await page.evaluate(() => window.fullscreenExited), true);
      assert.equal(await page.evaluate(() => window.presentDuringExit), false, 'delayed exit cannot hold the player open');
    }
    await open();
    await page.locator('video').evaluate(v => {
      window.fullscreenExited = false;
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => window.fullscreenExited ? null : v });
      document.exitFullscreen = () => Promise.reject(new Error('Fixture fullscreen exit failure'));
    });
    await runToEnd(); await closed();
    await page.evaluate(() => { window.fullscreenExited = true; document.dispatchEvent(new Event('fullscreenchange')); });
    console.log(`PASS ${engine} ${width}px: standard and simulated native exits attempted; delayed/rejected exits cannot prevent closing`);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
