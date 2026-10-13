// Real media completion with iPhone API shapes/event ordering. Desktop WebKit
// cannot present AVKit, so these native surfaces are explicitly simulated.
import assert from 'node:assert/strict';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5217';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const variants = ['presentation', 'stale-flags', 'alias', 'rejected-presentation', 'rejected-document', 'lagging-ended', 'deferred-ended', 'late-exit', 'flag-only-exit']
  .filter(variant => !process.env.IPHONE_FULLSCREEN_CASE || variant === process.env.IPHONE_FULLSCREEN_CASE);
async function open(page) {
  await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
  await page.waitForFunction(() => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false; v.pause(); return true; });
}
async function playback(page) {
  await page.locator('video').evaluate(v => { v.currentTime = 0; });
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.seeking; });
  await page.locator('video').evaluate((v, rate) => { v.playbackRate = rate; void v.play(); }, engine === 'webkit' ? 1 : 4);
}
async function installNative(page, variant) {
  await page.locator('video').evaluate((v, variant) => {
    window.iosExitCalls = []; window.iosExited = false; window.presentDuringIOSExit = false;
    let mode = 'fullscreen';
    const presentation = ['presentation', 'rejected-presentation', 'rejected-document', 'lagging-ended', 'deferred-ended'].includes(variant);
    let documentFullscreen = variant === 'rejected-document';
    const define = (name, value) => Object.defineProperty(v, name, { configurable: true, writable: true, value });
    for (const method of ['webkitSetPresentationMode', 'webkitExitFullscreen', 'webkitExitFullScreen']) define(method, undefined);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => documentFullscreen ? v : null });
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => null });
    Object.defineProperty(v, 'webkitPresentationMode', { configurable: true, get: () => presentation ? mode : undefined });
    Object.defineProperty(v, 'webkitDisplayingFullscreen', { configurable: true, get: () => variant === 'flag-only-exit' ? !window.iosExited : variant === 'stale-flags' });
    document.exitFullscreen = () => { window.iosExitCalls.push('document'); throw new Error('Native controller requires video presentation API'); };
    const exit = api => {
      window.iosExitCalls.push(api);
      setTimeout(() => {
        window.presentDuringIOSExit = v.isConnected; window.iosExited = true;
        mode = 'inline'; documentFullscreen = false;
        if (variant !== 'flag-only-exit') v.dispatchEvent(new Event(presentation ? 'webkitpresentationmodechanged' : 'webkitendfullscreen'));
      }, variant === 'late-exit' ? 2200 : 90);
    };
    if (presentation) define('webkitSetPresentationMode', next => {
      if (next !== 'inline') throw new Error('Expected inline presentation');
      if (variant === 'rejected-presentation') { window.iosExitCalls.push('rejected-presentation'); throw new Error('Unavailable presentation API'); }
      exit('presentation');
    });
    if (variant === 'alias' || variant === 'rejected-presentation') define('webkitExitFullScreen', () => exit('alias'));
    if (['stale-flags', 'late-exit', 'flag-only-exit'].includes(variant)) define('webkitExitFullscreen', () => exit('legacy'));
    if (variant === 'lagging-ended' || variant === 'deferred-ended') {
      let endedFlag = false;
      Object.defineProperty(v, 'ended', { configurable: true, get: () => endedFlag });
      v.addEventListener('ended', event => {
        if (variant === 'lagging-ended') Object.defineProperty(v, 'seeking', { configurable: true, get: () => true });
        else {
          event.stopImmediatePropagation(); endedFlag = true;
          queueMicrotask(() => v.dispatchEvent(new Event('timeupdate')));
        }
      }, { capture: true });
    }
    v.dispatchEvent(new Event('webkitbeginfullscreen'));
    if (presentation) v.dispatchEvent(new Event('webkitpresentationmodechanged'));
  }, variant);
}
try {
  for (const width of [390, 844]) {
    for (const variant of variants) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 390 }, hasTouch: true });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      if (engine === 'webkit') await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/playback-ended.mp4' } }));
      await page.goto(base + '/tests/public-previews.html?consumption=1'); await open(page);
      await installNative(page, variant);
      const dialog = page.getByRole('dialog', { name: 'Video player', exact: true });
      const position = await page.evaluate(() => scrollY);
      await playback(page);
      if (variant === 'late-exit') {
        await page.waitForFunction(() => window.iosExitCalls.length > 0);
        assert.ok(await dialog.isVisible(), 'keep the player mounted during delayed exit');
      }
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.iosExited), true);
      assert.equal(await page.evaluate(() => window.presentDuringIOSExit), true, 'fullscreen must exit before removing video');
      const expected = variant === 'rejected-document' ? ['document', 'presentation'] : variant === 'rejected-presentation' ? ['rejected-presentation', 'alias'] : [variant === 'alias' ? 'alias' : ['stale-flags', 'late-exit', 'flag-only-exit'].includes(variant) ? 'legacy' : 'presentation'];
      assert.deepEqual(await page.evaluate(() => window.iosExitCalls), expected);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.equal(await page.locator('[inert]').count(), 0);
      assert.equal(await page.evaluate(() => scrollY), position);
      assert.equal(await page.locator('video').count(), 0);
      await open(page); assert.ok(await dialog.isVisible());
      await page.getByRole('button', { name: 'Close video player', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
      console.log(`PASS ${engine} iPhone ${width}px: ${variant}, exit before close, no duplicate requests, scroll cleanup/reopen`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true });
    if (engine === 'webkit') await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/playback-ended.mp4' } }));
    await page.goto(base + '/tests/public-previews.html?consumption=1'); await open(page); await installNative(page, 'presentation');
    const dialog = page.getByRole('dialog', { name: 'Video player', exact: true });
    await page.locator('video').evaluate(v => { for (const name of ['waiting', 'stalled', 'pause']) v.dispatchEvent(new Event(name)); });
    await page.waitForTimeout(150); assert.ok(await dialog.isVisible());
    await page.locator('video').evaluate(v => { v.currentTime = v.duration; });
    await page.waitForFunction(() => !document.querySelector('video')?.seeking);
    await page.waitForTimeout(150); assert.ok(await dialog.isVisible());
    assert.deepEqual(await page.evaluate(() => window.iosExitCalls), []);
    await page.locator('video').evaluate(v => { v.dispatchEvent(new Event('webkitendfullscreen')); });
    assert.ok(await dialog.isVisible(), 'manually leaving fullscreen after a seek must not close');
    await page.getByRole('button', { name: 'Close video player', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    console.log(`PASS ${engine} iPhone ${width}px: pause/buffering/seek/manual fullscreen exit do not auto-close`);
    await open(page); await installNative(page, 'presentation');
    await page.locator('video').evaluate(v => {
      v.webkitSetPresentationMode = () => { window.iosExitCalls.push('rejected'); throw new Error('Exit temporarily rejected'); };
    });
    await playback(page); await dialog.getByRole('alert').waitFor();
    await page.locator('video').evaluate(v => { for (let i = 0; i < 5; i++) v.dispatchEvent(new Event('timeupdate')); });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.iosExitCalls), ['rejected'], 'progress must not loop failed exit requests');
    await page.locator('video').evaluate(v => {
      Object.defineProperty(v, 'webkitPresentationMode', { configurable: true, get: () => 'inline' });
      v.dispatchEvent(new Event('webkitpresentationmodechanged'));
    });
    await dialog.waitFor({ state: 'hidden' });
    console.log(`PASS ${engine} iPhone ${width}px: rejected native exit does not retry on every progress event; later exit completes close`);
    await page.close();
  }
} finally { await browser.close(); }
