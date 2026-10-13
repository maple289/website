// Real player and playback. Mobile APIs are simulated: desktop WebKit cannot
// reproduce iOS AVKit. No production traffic, credentials or media mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const base = process.env.TEST_BASE_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
async function open(page) {
  await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
  await page.waitForFunction(() => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false; v.pause(); return true; });
}
async function install(page, api) {
  await page.locator('video').evaluate((v, api) => {
    const surface = document.querySelector('.video-fullscreen-surface');
    let mode = 'inline', fullscreenElement = null, pipElement = null;
    window.modeCalls = []; window.rejectEntry = false; window.rejectExit = false; window.modeDelay = 90;
    window.connectedOnExit = false;
    const define = (target, name, value) => Object.defineProperty(target, name, { configurable: true, writable: true, value });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => pipElement });
    define(document, 'fullscreenEnabled', api === 'standard');
    define(document, 'webkitFullscreenEnabled', false);
    define(document, 'pictureInPictureEnabled', api === 'standard');
    for (const name of ['webkitEnterFullscreen', 'webkitEnterFullScreen', 'webkitExitFullscreen', 'webkitExitFullScreen', 'webkitSetPresentationMode']) define(v, name, undefined);
    Object.defineProperty(v, 'webkitPresentationMode', { configurable: true, get: () => api === 'standard' ? undefined : mode });
    define(v, 'webkitSupportsPresentationMode', () => true);
    const change = next => {
      const previous = mode;
      mode = next;
      fullscreenElement = api === 'standard' && mode === 'fullscreen' ? surface : null;
      pipElement = api === 'standard' && mode === 'picture-in-picture' ? v : null;
      if (next === 'inline') window.connectedOnExit = v.isConnected;
      if (api === 'standard') {
        document.dispatchEvent(new Event('fullscreenchange'));
        if (previous === 'picture-in-picture') v.dispatchEvent(new Event('leavepictureinpicture'));
        if (next === 'picture-in-picture') v.dispatchEvent(new Event('enterpictureinpicture'));
      } else {
        if (next === 'fullscreen') v.dispatchEvent(new Event('webkitbeginfullscreen'));
        if (previous === 'fullscreen' && next === 'inline') v.dispatchEvent(new Event('webkitendfullscreen'));
        v.dispatchEvent(new Event('webkitpresentationmodechanged'));
      }
    };
    window.systemExit = () => change('inline');
    const request = (next, name, returnsPromise = false) => {
      window.modeCalls.push({ name, next, activation: navigator.userActivation?.isActive ?? true });
      if (next !== 'inline' && window.rejectEntry || next === 'inline' && window.rejectExit) {
        if (returnsPromise) return Promise.reject(new Error('Fixture API rejection'));
        throw new Error('Fixture API rejection');
      }
      if (returnsPromise) return new Promise(resolve => setTimeout(() => { change(next); resolve(); }, window.modeDelay));
      setTimeout(() => change(next), window.modeDelay);
    };
    surface.requestFullscreen = () => request('fullscreen', 'container-fullscreen', true);
    document.exitFullscreen = () => request('inline', 'document-exit', true);
    v.requestPictureInPicture = () => request('picture-in-picture', 'standard-pip', true);
    document.exitPictureInPicture = () => request('inline', 'standard-pip-exit', true);
    define(v, 'webkitSetPresentationMode', next => request(next, 'presentation'));
    if (api === 'legacy') {
      define(v, 'webkitEnterFullScreen', () => request('fullscreen', 'legacy-enter'));
      define(v, 'webkitExitFullScreen', () => request('inline', 'legacy-exit'));
    }
    v.dispatchEvent(new Event('loadedmetadata'));
  }, api);
}
async function playToEnd(page) {
  await page.locator('video').evaluate(v => { v.currentTime = 0; });
  await page.waitForFunction(() => !document.querySelector('video')?.seeking);
  await page.locator('video').evaluate((v, rate) => { v.playbackRate = rate; void v.play(); }, engine === 'webkit' ? 1 : 4);
}
try {
  for (const width of process.env.VIDEO_PRESENTATION_CASE ? [] : [390, 768]) {
    for (const api of ['standard', 'presentation', 'legacy']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      if (engine === 'webkit') await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/playback-ended.mp4' } }));
      await page.goto(base + '/tests/public-previews.html?consumption=1'); await open(page); await install(page, api);
      const button = name => page.getByRole('button', { name, exact: true });
      const dialog = page.getByRole('dialog', { name: 'Video player', exact: true });
      const position = await page.evaluate(() => scrollY);
      assert.equal(await page.locator('video').evaluate(v => v.controls), false, 'one inline control bar, no native duplicates');
      await button('Play video').click(); await button('Pause video').waitFor();
      await button('Pause video').click(); await button('Play video').waitFor();
      await button('Mute video').click(); await button('Unmute video').waitFor();
      await button('Unmute video').click(); await button('Mute video').waitFor();
      await page.getByRole('slider', { name: 'Video position', exact: true }).focus();
      await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('video').currentTime > 0 && !document.querySelector('video').seeking);
      assert.ok(await dialog.isVisible(), 'seeking and pausing through the control bar keeps the gallery player open');
      if (width === 390 && api === 'standard') await page.screenshot({ path: `.runtime/video-presentation-${engine}-phone.png` });
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const sequence of [ ['Enter fullscreen', 'Exit fullscreen'], ['Enter fullscreen', 'Exit fullscreen'],
          ['Enter picture-in-picture', 'Exit picture-in-picture'], ['Enter fullscreen', 'Exit fullscreen'] ]) {
          await button(sequence[0]).click();
          await button(sequence[1]).waitFor();
          assert.equal(await button(sequence[0].includes('picture') ? 'Enter fullscreen' : 'Enter picture-in-picture').isDisabled(), true, 'conflicting mode cannot queue an entry');
          await page.setViewportSize({ width: 844, height: width });
          await page.setViewportSize({ width, height: 844 });
          await page.locator('video').evaluate(v => { v.dispatchEvent(new Event('waiting')); v.dispatchEvent(new Event('stalled')); v.pause(); v.currentTime = 0.3; });
          assert.ok(await dialog.isVisible());
          await button(sequence[1]).click(); await button(sequence[0]).waitFor();
          assert.equal(await page.locator('video').evaluate(v => v.controls), false);
        }
      }
      const calls = await page.evaluate(() => window.modeCalls);
      assert.equal(calls.length, 24);
      assert.ok(calls.every(call => call.activation), 'API must run within the button user activation');
      assert.deepEqual(calls.map(call => call.next), Array.from({ length: 3 }, () => ['fullscreen', 'inline', 'fullscreen', 'inline', 'picture-in-picture', 'inline', 'fullscreen', 'inline']).flat());
      await button('Enter fullscreen').click(); await button('Exit fullscreen').waitFor();
      await page.evaluate(() => window.systemExit()); await button('Enter fullscreen').waitFor();
      assert.ok(await dialog.isVisible(), 'system exit does not close mid-play');
      await button('Enter fullscreen').click(); await button('Exit fullscreen').waitFor();
      await page.evaluate(() => { window.rejectExit = true; });
      await button('Exit fullscreen').click(); await dialog.getByRole('alert').waitFor();
      assert.equal(await button('Exit fullscreen').count(), 1, 'rejected exit retains actual fullscreen state');
      await page.evaluate(() => { window.rejectExit = false; });
      await button('Exit fullscreen').click(); await button('Enter fullscreen').waitFor();
      await page.evaluate(() => { window.rejectEntry = true; });
      await button('Enter fullscreen').click(); await dialog.getByRole('alert').waitFor();
      assert.equal(await button('Exit fullscreen').count(), 0, 'failed request cannot optimistically set fullscreen');
      await page.evaluate(() => { window.rejectEntry = false; });
      const previous = await page.evaluate(() => window.modeCalls.length);
      await button('Enter picture-in-picture').click(); await button('Exit picture-in-picture').waitFor();
      assert.deepEqual(await page.evaluate(n => window.modeCalls.slice(n).map(c => c.next), previous), ['picture-in-picture'], 'PiP tap cannot replay rejected fullscreen');
      await button('Exit picture-in-picture').click(); await button('Enter picture-in-picture').waitFor();
      await button('Enter picture-in-picture').click(); await button('Exit picture-in-picture').waitFor();
      await page.evaluate(() => { window.rejectExit = true; });
      await button('Close video player').click(); await dialog.getByRole('alert').waitFor();
      assert.ok(await dialog.isVisible(), 'rejected PiP exit keeps the source and player mounted');
      await page.evaluate(() => { window.rejectExit = false; window.systemExit(); });
      await dialog.waitFor({ state: 'hidden' });
      await open(page); await install(page, api);
      // Native/standard PiP must exit before modal removal, on manual close and end.
      for (const natural of [false, true, 'deferred-ended']) {
        await button('Enter picture-in-picture').click(); await button('Exit picture-in-picture').waitFor();
        if (natural === 'deferred-ended') await page.locator('video').evaluate(v => {
          v.addEventListener('ended', event => {
            event.stopImmediatePropagation();
            queueMicrotask(() => v.dispatchEvent(new Event('timeupdate')));
          }, { capture: true });
        });
        if (natural) await playToEnd(page);
        else await button('Close video player').click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.connectedOnExit), true);
        assert.equal(await page.evaluate(() => document.pictureInPictureElement), null);
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        assert.equal(await page.locator('[inert]').count(), 0);
        assert.equal(await page.evaluate(() => scrollY), position);
        await open(page); await install(page, api);
      }
      await button('Enter fullscreen').click(); await button('Exit fullscreen').waitFor();
      await playToEnd(page); await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.connectedOnExit), true);
      assert.equal(await page.evaluate(() => document.fullscreenElement), null);
      assert.deepEqual(errors, []);
      for (const mode of ['fullscreen', 'picture-in-picture']) {
        await open(page); await install(page, api);
        await page.evaluate(() => { window.modeDelay = 250; });
        await button('Enter ' + mode).click();
        await button('Close video player').click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.connectedOnExit), true, 'close during entry waits and exits before removing video');
        assert.deepEqual(await page.evaluate(() => window.modeCalls.map(call => call.next)), [mode, 'inline']);
      }
      await open(page); await install(page, api);
      await page.locator('video').evaluate(v => {
        Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: false });
        v.webkitSupportsPresentationMode = value => value === 'fullscreen';
        v.dispatchEvent(new Event('loadedmetadata'));
      });
      await button('Enter picture-in-picture').waitFor({ state: 'hidden' });
      assert.equal(await button('Enter picture-in-picture').count(), 0, 'unsupported PiP is unavailable');
      await button('Close video player').click(); await dialog.waitFor({ state: 'hidden' });
      console.log(`PASS ${engine} ${width}px ${api}: repeated independent controls, direct activation, rotation, system/rejected entry, manual/PiP/fullscreen ended cleanup`);
      await page.close();
    }
  }
  if (!process.env.VIDEO_PRESENTATION_CASE || process.env.VIDEO_PRESENTATION_CASE === 'readiness') {
    for (const api of ['standard', 'presentation']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      if (engine === 'webkit') await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/playback-ended.mp4' } }));
      await page.goto(base + '/tests/public-previews.html?consumption=1'); await open(page); await install(page, api);
      await page.locator('video').evaluate(v => {
        window.fixtureReadyState = 0;
        Object.defineProperty(v, 'readyState', { configurable: true, get: () => window.fixtureReadyState });
        v.dispatchEvent(new Event('loadedmetadata'));
      });
      const button = name => page.getByRole('button', { name, exact: true });
      await button('Enter picture-in-picture').waitFor({ state: 'hidden' });
      if (api === 'presentation') await button('Enter fullscreen').waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => window.modeCalls), [], 'metadata changes cannot request or queue a display mode');
      await page.locator('video').evaluate(v => { window.fixtureReadyState = 4; v.dispatchEvent(new Event('loadedmetadata')); });
      await button('Enter fullscreen').waitFor(); await button('Enter picture-in-picture').waitFor();
      await button('Enter fullscreen').click(); await button('Exit fullscreen').waitFor();
      await button('Exit fullscreen').click(); await button('Enter fullscreen').waitFor();
      await button('Enter picture-in-picture').click(); await button('Exit picture-in-picture').waitFor();
      await button('Close video player').click();
      await page.getByRole('dialog', { name: 'Video player', exact: true }).waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => window.modeCalls.map(c => c.next)), ['fullscreen', 'inline', 'picture-in-picture', 'inline']);
      console.log(`PASS ${engine} ${api}: no native/PiP requests before metadata, first eligible tap enters, independent cleanup`);
      await page.close();
    }
  }
  if (!process.env.VIDEO_PRESENTATION_CASE || process.env.VIDEO_PRESENTATION_CASE === 'file') {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/tests/video-file-controls.html?codec=' + (engine === 'webkit' ? 'mp4' : 'webm'));
    const dialog = page.getByRole('dialog', { name: 'File preview', exact: true });
    const openFile = async () => {
      await page.getByRole('button', { name: 'Open video file preview', exact: true }).click();
      // Non-autoplay WebKit may preload metadata only until the user presses Play.
      try { await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1 || document.body.innerText.includes('This video cannot be played by your browser.')); }
      catch (error) {
        console.log('FILE VIDEO DIAGNOSTICS', await page.evaluate(() => {
          const v = document.querySelector('video');
          return { text: document.body.innerText, video: v && { ready: v.readyState, network: v.networkState, preload: v.preload, error: v.error?.message, sourceType: v.src.startsWith('blob:') ? 'blob' : 'url' } };
        }));
        throw error;
      }
      if (!await page.locator('video').count()) return false;
      await install(page, 'presentation');
      return true;
    };
    const playable = await openFile();
    if (!playable) {
      assert.equal(engine, 'webkit'); assert.equal(process.platform, 'win32');
      // Establish a runtime limitation independently of the application, rather
      // than allowing a FilePreview regression to pass as an unsupported codec.
      const probe = await page.evaluate(async () => {
        const response = await fetch('/tests/fixtures/playback-ended.mp4'), blob = await response.blob();
        const results = [];
        for (const source of ['url', 'blob']) {
          const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.preload = 'auto';
          const result = new Promise(resolve => {
            const timer = setTimeout(() => resolve({ event: 'timeout' }), 5000);
            for (const event of ['loadedmetadata', 'error']) v.addEventListener(event, () => {
              clearTimeout(timer); resolve({ event, ready: v.readyState, code: v.error?.code });
            }, { once: true });
          });
          const url = source === 'blob' ? URL.createObjectURL(blob) : '/tests/fixtures/playback-ended.mp4';
          v.src = url; document.querySelector('[role="dialog"]').append(v);
          results.push({ source, ...await result });
          v.pause(); v.removeAttribute('src'); v.load(); v.remove(); if (source === 'blob') URL.revokeObjectURL(url);
        }
        return { http: response.status, mime: blob.type, size: blob.size, results };
      });
      assert.equal(probe.http, 200); assert.equal(probe.mime, 'video/mp4');
      assert.equal(probe.results[0].event, 'loadedmetadata');
      assert.equal(probe.results[1].event, 'error'); assert.equal(probe.results[1].code, 4);
      await fs.writeFile('.runtime/webkit-blob-validation.json', JSON.stringify(probe, null, 2));
      assert.ok(await dialog.isVisible());
      assert.ok((await dialog.innerText()).includes('This video cannot be played by your browser.'));
      assert.equal(await dialog.getByRole('button', { name: 'Download original file', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Close preview', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.equal(await page.locator('[inert]').count(), 0); assert.deepEqual(errors, []);
      console.log('LIMITED Windows WebKit: identical MP4 works over HTTP but Blob URLs fail with native/custom controls; file-preview fallback/close passed, file playback unverified');
    } else {
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.connectedOnExit), true);
    await openFile();
    await page.getByRole('button', { name: 'Enter picture-in-picture', exact: true }).click();
    await page.getByRole('button', { name: 'Exit picture-in-picture', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Play video', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.connectedOnExit), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    assert.equal(await page.locator('[inert]').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${engine}: real video-file preview, StrictMode lifecycle, native fullscreen manual close, PiP natural end, source release/reopen`);
    }
    await page.close();
  }
  if ((engine === 'chromium' || engine === 'firefox') && (!process.env.VIDEO_PRESENTATION_CASE || process.env.VIDEO_PRESENTATION_CASE === 'desktop')) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(base + '/tests/public-previews.html?consumption=1'); await open(page);
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement?.classList.contains('video-player-surface'));
      const geometry = await page.locator('.video-player-surface').evaluate(surface => {
        const rect = surface.getBoundingClientRect(), video = surface.querySelector('video');
        return { width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, fit: getComputedStyle(video).objectFit };
      });
      assert.ok(Math.abs(geometry.width - geometry.viewportWidth) < 1, 'surface fills viewport width within CSS pixel rounding');
      assert.ok(Math.abs(geometry.height - geometry.viewportHeight) < 1, 'surface fills viewport height within CSS pixel rounding');
      assert.equal(geometry.fit, 'contain');
      if (!repeat) await page.screenshot({ path: `.runtime/video-presentation-${engine}-desktop-fullscreen.png` });
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await page.waitForFunction(() => !document.fullscreenElement);
    }
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
    await playToEnd(page);
    await page.getByRole('dialog', { name: 'Video player', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
    console.log(`PASS actual ${engine} container fullscreen: first tap, full viewport layout, repeated exit/re-entry, natural end`);
    await page.close();
  }
} finally { await browser.close(); }
