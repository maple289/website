// Real viewers with local media; native-video APIs and unavailable/rejected
// container fullscreen are simulated. This is not a physical iPhone test.
import assert from 'node:assert/strict';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const base = process.env.TEST_BASE_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#124d75"/></svg>';
const currentPhoto = '.pv-slide[aria-hidden="false"] .pv-photo';
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();

async function fixture(width = 390, touch = true, height = 844) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.fixtureErrors = errors;
  if (engine === 'webkit') await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/playback-ended.mp4' } }));
  await page.route('**/storage/v1/object/sign/**', r => r.request().method() === 'GET' ? r.fulfill({ contentType: 'image/svg+xml', body: image }) : r.continue());
  await page.goto(base + '/tests/public-previews.html?consumption=1&mediaGestures=1');
  return page;
}
async function openVideo(page) {
  await click(page, 'Play Public video');
  await page.waitForFunction(() => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false; v.pause(); return true; });
}
async function openPhoto(page) {
  await click(page, 'photos'); await click(page, 'Open Public photo');
  await page.locator(currentPhoto).waitFor();
  await page.waitForFunction(selector => document.querySelector(selector)?.naturalWidth > 0, currentPhoto);
}
// Deterministic native TouchEvent-shaped sequences are needed for Firefox and
// Windows WebKit, which do not supply mobile hardware touch input to Playwright.
async function gesture(page, selector, kind, point = [.25, .25]) {
  return page.locator(selector).evaluate(async (element, { kind, point }) => {
    const r = element.getBoundingClientRect(), x = r.x + r.width * point[0], y = r.y + r.height * point[1];
    const touch = (dx = 0, dy = 0, id = 1) => ({ identifier: id, target: element, clientX: x + dx, clientY: y + dy });
    const send = (name, touches, changed = [touch()]) => {
      const e = new Event(name, { bubbles: true, cancelable: true });
      Object.defineProperties(e, { touches: { value: touches }, changedTouches: { value: changed } });
      element.dispatchEvent(e); return e.defaultPrevented;
    };
    const tap = () => { send('touchstart', [touch()]); return send('touchend', []); };
    if (kind === 'double') { tap(); return tap(); }
    if (kind === 'single') return tap();
    send('touchstart', [touch()]);
    if (kind === 'swipe') { send('touchmove', [touch(-110)]); send('touchend', [], [touch(-110)]); }
    if (kind === 'vertical') { send('touchmove', [touch(0, 50)]); send('touchend', [], [touch(0, 50)]); }
    if (kind === 'pinch') { send('touchstart', [touch(), touch(40, 0, 2)]); send('touchmove', [touch(-20), touch(60, 0, 2)]); send('touchend', [touch()], [touch(60, 0, 2)]); send('touchend', []); }
    if (kind === 'cancel') { send('touchcancel', []); send('touchend', []); }
    if (kind === 'long') { await new Promise(resolve => setTimeout(resolve, 330)); send('touchend', []); }
    if (kind === 'slow') { send('touchend', []); await new Promise(resolve => setTimeout(resolve, 330)); tap(); }
    return false;
  }, { kind, point });
}
async function modes(page, api, touchPoints = 0) {
  await page.locator('video').evaluate((v, { api, touchPoints }) => {
    const surface = document.querySelector('.video-player-surface');
    let mode = 'inline'; window.modeCalls = [];
    const define = (object, name, value) => Object.defineProperty(object, name, { configurable: true, writable: true, value });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touchPoints });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => api === 'standard' && mode === 'fullscreen' ? surface : null });
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => api === 'vendor' && mode === 'fullscreen' ? surface : null });
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => api === 'standard' && mode === 'picture-in-picture' ? v : null });
    define(document, 'fullscreenEnabled', api === 'standard'); define(document, 'webkitFullscreenEnabled', api === 'vendor');
    define(document, 'pictureInPictureEnabled', api === 'standard');
    Object.defineProperty(v, 'webkitPresentationMode', { configurable: true, get: () => api === 'presentation' ? mode : api === 'native-events' ? 'inline' : undefined });
    Object.defineProperty(v, 'webkitDisplayingFullscreen', { configurable: true, get: () => api === 'legacy' && mode === 'fullscreen' });
    define(v, 'webkitSupportsFullscreen', api === 'legacy' || api === 'native-events');
    define(v, 'webkitSupportsPresentationMode', () => api === 'presentation');
    const change = next => {
      const old = mode;
      mode = next;
      if (api === 'native-events') {
        // iOS native events can prove the mode before presentation properties
        // report it. The next toggle must use the same observed mode as the UI.
        v.dispatchEvent(new Event(next === 'fullscreen' ? 'webkitbeginfullscreen' : 'webkitendfullscreen'));
        return;
      }
      document.dispatchEvent(new Event('fullscreenchange'));
      document.dispatchEvent(new Event('webkitfullscreenchange'));
      if (api === 'presentation' || api === 'legacy') {
        if (next === 'fullscreen' && old !== 'fullscreen') v.dispatchEvent(new Event('webkitbeginfullscreen'));
        if (old === 'fullscreen' && next !== 'fullscreen') v.dispatchEvent(new Event('webkitendfullscreen'));
        v.dispatchEvent(new Event('webkitpresentationmodechanged'));
      }
      if (next === 'picture-in-picture' && old !== 'picture-in-picture') v.dispatchEvent(new Event('enterpictureinpicture'));
      if (old === 'picture-in-picture' && next !== 'picture-in-picture') v.dispatchEvent(new Event('leavepictureinpicture'));
    };
    const request = (name, next) => { window.modeCalls.push({ name, next }); change(next); };
    surface.requestFullscreen = () => { request('standard', 'fullscreen'); return Promise.resolve(); };
    surface.webkitRequestFullscreen = () => request('vendor', 'fullscreen');
    document.exitFullscreen = () => { request('standard-exit', 'inline'); return Promise.resolve(); };
    document.webkitExitFullscreen = () => request('vendor-exit', 'inline');
    // Remove standard exit in the prefixed fixture.
    if (api === 'vendor') define(document, 'exitFullscreen', undefined);
    define(v, 'webkitSetPresentationMode', api === 'presentation' ? next => request('presentation', next) : undefined);
    define(v, 'webkitEnterFullscreen', api === 'legacy' || api === 'native-events' ? () => request('legacy', 'fullscreen') : undefined);
    define(v, 'webkitExitFullscreen', api === 'legacy' || api === 'native-events' ? () => request('legacy-exit', 'inline') : undefined);
    define(v, 'webkitEnterFullScreen', undefined); define(v, 'webkitExitFullScreen', undefined);
    v.requestPictureInPicture = () => { request('pip', 'picture-in-picture'); return Promise.resolve(); };
    document.exitPictureInPicture = () => { request('pip-exit', 'inline'); return Promise.resolve(); };
    v.dispatchEvent(new Event('loadedmetadata'));
  }, { api, touchPoints });
}

async function videoPageGeometry(page) {
  const g = await page.locator('.video-player-surface').evaluate(surface => {
    const r = surface.getBoundingClientRect(), v = surface.querySelector('video');
    return { width: r.width, height: r.height, x: r.x, y: r.y, vw: innerWidth, vh: innerHeight,
      fit: getComputedStyle(v).objectFit, portal: surface.closest('[data-task-modal]')?.parentElement === document.body };
  });
  for (const [actual, expected] of [[g.x, 0], [g.y, 0], [g.width, g.vw], [g.height, g.vh]]) assert.ok(Math.abs(actual - expected) < 1, JSON.stringify(g));
  assert.equal(g.fit, 'contain'); assert.equal(g.portal, true);
  for (const name of ['Close video player', 'Exit fullscreen']) {
    assert.equal(await page.getByRole('button', { name, exact: true }).evaluate(b => {
      const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), true, name + ' receives taps in the page fullscreen viewer');
  }
}
async function mobileVideoLayout(page, fullscreen = false) {
  const g = await page.locator('.video-player-surface').evaluate(surface => {
    const video = surface.querySelector('video'), stage = surface.querySelector('.video-playback-area');
    const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    return { surface: box(surface), stage: box(stage), video: box(video), vw: innerWidth, vh: innerHeight,
      scrollHeight: surface.scrollHeight, clientHeight: surface.clientHeight, scrollTop: surface.scrollTop, fit: getComputedStyle(video).objectFit };
  });
  assert.ok(g.surface.x >= -1 && g.surface.y >= -1 && g.surface.right <= g.vw + 1 && g.surface.bottom <= g.vh + 1, JSON.stringify(g));
  assert.ok(g.video.width > 0 && g.video.height > 0 && g.video.x >= g.stage.x - 1 && g.video.y >= g.stage.y - 1 && g.video.right <= g.stage.right + 1 && g.video.bottom <= g.stage.bottom + 1, 'complete video fits its stage: ' + JSON.stringify(g));
  assert.equal(g.fit, 'contain');
  if (!fullscreen) {
    assert.ok(Math.abs(g.stage.width / g.stage.height - 16 / 9) < .01, 'retain the previous normal video size instead of squeezing it into smaller rows');
    return g;
  }
  assert.ok(g.scrollHeight <= g.clientHeight + 1 && g.scrollTop === 0, 'fullscreen must not scroll: ' + JSON.stringify(g));
  for (const box of [g.stage, g.video]) {
    assert.ok(Math.abs(box.x) < 1 && Math.abs(box.y) < 1 && Math.abs(box.width - g.vw) < 1 && Math.abs(box.height - g.vh) < 1, 'fullscreen picture uses the entire viewport, without reserved application control rows: ' + JSON.stringify(g));
  }
  for (const name of ['Close video player', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen']) {
    assert.equal(await page.getByRole('button', { name, exact: true }).evaluate(b => {
      const r = b.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), true, name + ' is visible and receives taps without scrolling');
  }
  return g;
}
async function geometry(page) {
  await page.waitForFunction(selector => document.querySelector(selector)?.naturalWidth > 0, currentPhoto);
  const g = await page.locator('.photo-viewer').evaluate(root => {
    const r = root.getBoundingClientRect(), stage = root.querySelector('.pv-stage').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, stageWidth: stage.width, stageHeight: stage.height, vw: innerWidth, vh: innerHeight,
      fit: getComputedStyle(root.querySelector('.pv-photo')).objectFit, parent: root.parentElement.tagName,
      transform: getComputedStyle(root.querySelector('.pv-photo')).transform, touchAction: getComputedStyle(root.querySelector('.pv-stage')).touchAction };
  });
  assert.equal(g.parent, 'BODY', 'viewer escapes transformed/overflow-constrained ancestors');
  for (const [actual, expected] of [[g.x, 0], [g.y, 0], [g.width, g.vw], [g.height, g.vh], [g.stageWidth, g.vw], [g.stageHeight, g.vh]]) assert.ok(Math.abs(actual - expected) < 1, JSON.stringify(g));
  assert.equal(g.fit, 'contain'); assert.equal(g.transform, 'none'); assert.match(g.touchAction, /pinch-zoom/);
  for (const label of ['Close', 'Exit photo fullscreen', 'Next photo', 'Previous photo']) {
    assert.equal(await page.getByRole('button', { name: label, exact: true }).evaluate(b => {
      const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), true, `${label} is accessible in fullscreen`);
  }
}
try {
  for (const [width, height] of [[390, 844], [844, 390], [932, 430], [844, 320], [768, 1024], [1024, 768]]) {
    const page = await fixture(width, true, height); await openVideo(page); await modes(page, 'presentation', 5);
    assert.equal(await page.locator('.video-page-fullscreen').count(), 0, 'opening a video must start in the normal viewer');
    const normal = await mobileVideoLayout(page);
    for (let i = 0; i < 2; i++) {
      await click(page, 'Enter fullscreen'); await videoPageGeometry(page);
      const expanded = await mobileVideoLayout(page, true);
      assert.ok(expanded.video.width > normal.video.width && expanded.video.height >= Math.min(normal.video.height, normal.surface.bottom - normal.video.y), 'fullscreen expands the visible media area');
      if (process.env.CAPTURE_MEDIA_GESTURES && i === 0) await page.screenshot({ path: `.runtime/video-button-full-${engine}-${width}x${height}.png` });
      if (i === 0) await click(page, 'Exit fullscreen');
      else await gesture(page, 'video', 'double');
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).waitFor();
      const restored = await mobileVideoLayout(page);
      assert.ok(Math.abs(restored.video.height - normal.video.height) < 1 && Math.abs(restored.video.width - normal.video.width) < 1, 'exit restores the previous normal video size');
    }
    if (process.env.CAPTURE_MEDIA_GESTURES) await page.screenshot({ path: `.runtime/video-button-normal-${engine}-${width}x${height}.png` });
    assert.deepEqual(await page.evaluate(() => window.modeCalls), [], 'the iPhone button keeps video presentation in the page');
    assert.deepEqual(page.fixtureErrors, []); await page.close();
    console.log(`PASS ${engine} mobile video button ${width}x${height}: previous normal size restored, fullscreen video fills viewport, button/gesture exits, overlay controls accessible`);
  }
  for (const api of ['native-events', 'standard', 'presentation', 'legacy', 'vendor']) {
    const page = await fixture(); await openVideo(page); await modes(page, api);
    for (let i = 0; i < 3; i++) {
      assert.equal(await gesture(page, 'video', 'double'), true);
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
      if (i === 0) {
        const r = await page.locator('video').boundingBox();
        await page.locator('video').dispatchEvent('dblclick', { clientX: r.x + r.width * .25, clientY: r.y + r.height * .25 });
        assert.equal(await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).count(), 1, 'synthetic touch double-click must not toggle again');
      }
      assert.equal(await gesture(page, 'video', 'double'), true);
      assert.equal(await page.evaluate(() => window.modeCalls.at(-1)?.next), 'inline', 'second double tap must exit, including event-confirmed native mode');
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).waitFor();
    }
    const gestureCalls = await page.evaluate(() => window.modeCalls.map(c => c.next));
    assert.deepEqual(gestureCalls, Array.from({ length: 3 }, () => ['fullscreen', 'inline']).flat());
    await click(page, 'Enter fullscreen'); await gesture(page, 'video', 'double');
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).waitFor();
    await gesture(page, 'video', 'double'); await click(page, 'Exit fullscreen');
    const callsBefore = await page.evaluate(() => window.modeCalls.length);
    for (const kind of ['swipe', 'vertical', 'pinch', 'cancel', 'long', 'slow']) {
      await gesture(page, 'video', kind); await gesture(page, 'video', 'cancel'); await gesture(page, 'video', 'single'); await gesture(page, 'video', 'cancel');
    }
    await gesture(page, 'video', 'double', [.5, .99]); // Native control strip.
    await gesture(page, 'video', 'double', [.5, .5]); // Paused native play overlay.
    await gesture(page, '.video-player-surface h3', 'double'); // Header.
    assert.equal(await page.evaluate(() => window.modeCalls.length), callsBefore);
    if (api === 'standard' || api === 'presentation') {
      await click(page, 'Enter picture-in-picture');
      assert.equal(await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).isDisabled(), true);
      await click(page, 'Exit picture-in-picture');
      await gesture(page, 'video', 'double'); await gesture(page, 'video', 'double');
      assert.ok((await page.evaluate(() => window.modeCalls.slice(-2).map(c => c.next))).every(m => m !== 'picture-in-picture'));
    }
    await click(page, 'Close video player');
    assert.deepEqual(page.fixtureErrors, []); await page.close();
    console.log(`PASS ${engine} video ${api}: repeated enter/exit, shared button state, controls/swipe/pinch/long-press exclusion, independent PiP`);
  }
  for (const api of ['presentation', 'legacy', 'container-noop', 'container-rejection']) {
    const page = await fixture(); await openVideo(page); await modes(page, api === 'legacy' ? 'legacy' : 'presentation', 5);
    await page.locator('video').evaluate(v => { window.pageFullscreenVideo = v; v.currentTime = .5; });
    if (api.startsWith('container-')) await page.evaluate(api => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      document.querySelector('.video-player-surface').requestFullscreen = () => {
        window.modeCalls.push({ name: api, next: 'fullscreen' });
        return api === 'container-rejection' ? Promise.reject(new Error('fixture unsupported container')) : Promise.resolve();
      };
      document.querySelector('video').dispatchEvent(new Event('loadedmetadata'));
    }, api);
    for (let i = 0; i < 3; i++) {
      await gesture(page, 'video', 'double'); await videoPageGeometry(page);
      assert.equal(await page.locator('video').evaluate(v => v === window.pageFullscreenVideo && v.currentTime >= .5), true, 'fullscreen retains the same video and playback position');
      assert.equal(await page.locator('.video-page-fullscreen').count(), 1);
      if (process.env.CAPTURE_MEDIA_GESTURES && i === 0) await page.screenshot({ path: `.runtime/video-page-fullscreen-${engine}-${api}.png` });
      await page.setViewportSize({ width: 844, height: 390 }); await videoPageGeometry(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await gesture(page, 'video', 'double');
      assert.equal(await page.locator('.video-page-fullscreen, .video-page-fullscreen-layer').count(), 0, 'second double tap removes fullscreen and its layer');
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).waitFor();
    }
    assert.ok((await page.evaluate(() => window.modeCalls)).every(c => c.name === api), 'iPhone viewer must never transfer media touches to native video fullscreen');
    assert.equal(await page.getByRole('alert').count(), 0, 'unsupported container fullscreen retains the working viewport fallback');
    await click(page, 'Enter fullscreen'); await gesture(page, 'video', 'double');
    await gesture(page, 'video', 'double'); await click(page, 'Exit fullscreen');
    if (api !== 'legacy') {
      await click(page, 'Enter picture-in-picture');
      assert.equal(await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).isDisabled(), true);
      await click(page, 'Exit picture-in-picture');
    }
    await click(page, 'Enter fullscreen'); await click(page, 'Close video player');
    assert.equal(await page.locator('.video-page-fullscreen-layer').count(), 0);
    assert.equal(await page.locator('[inert]').count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    await openVideo(page); await modes(page, api === 'legacy' ? 'legacy' : 'presentation', 5);
    await gesture(page, 'video', 'double');
    await page.locator('video').evaluate(async (v, rate) => { v.playbackRate = rate; await v.play(); }, engine === 'webkit' ? 1 : 4);
    await page.getByRole('dialog', { name: 'Video player', exact: true }).waitFor({ state: 'hidden', timeout: 6000 });
    assert.equal(await page.locator('.video-page-fullscreen-layer, [inert]').count(), 0, 'natural completion releases the fullscreen viewer and background lock');
    assert.deepEqual(page.fixtureErrors, []); await page.close();
    console.log(`PASS ${engine} iPhone-like ${api}: page owns both double taps, rotation, shared button, no native video takeover, PiP/Close cleanup`);
  }
  {
    const page = await fixture(); await openVideo(page); await modes(page, 'presentation', 5);
    await page.evaluate(() => {
      const surface = document.querySelector('.video-player-surface');
      let full = null;
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      surface.requestFullscreen = () => new Promise(resolve => { window.completeVideoEntry = () => {
        full = surface; document.dispatchEvent(new Event('fullscreenchange')); resolve();
      }; });
      document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
      document.querySelector('video').dispatchEvent(new Event('loadedmetadata'));
    });
    await gesture(page, 'video', 'double'); await videoPageGeometry(page);
    await gesture(page, 'video', 'double'); await page.evaluate(() => window.completeVideoEntry());
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).waitFor();
    assert.equal(await page.locator('.video-page-fullscreen, .video-page-fullscreen-layer').count(), 0, 'late native entry must respect the second double-tap exit');
    await click(page, 'Enter fullscreen'); await click(page, 'Close video player');
    await page.evaluate(() => window.completeVideoEntry()); await page.waitForFunction(() => !document.fullscreenElement);
    assert.deepEqual(page.fixtureErrors, []); await page.close();
    console.log(`PASS ${engine} delayed video container: second double tap cancels pending entry, late Close cleanup`);
  }
  for (const width of [390, 768]) {
    const page = await fixture(width); await openPhoto(page);
    // Force unsupported container fullscreen to verify the Safari CSS fallback.
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
      Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: false });
      const host = document.querySelector('#root'); host.style.cssText = 'transform:translateX(20px);overflow:hidden;max-width:180px;height:200px';
    });
    for (let i = 0; i < 3; i++) {
      assert.equal(await gesture(page, currentPhoto, 'double'), true); await geometry(page);
      if (process.env.CAPTURE_MEDIA_GESTURES && i === 0) await page.screenshot({ path: `.runtime/media-fullscreen-${engine}-${width}.png` });
      await gesture(page, currentPhoto, 'double');
      assert.equal(await page.locator('.pv-fullscreen').count(), 0);
    }
    await click(page, 'Enter photo fullscreen'); await geometry(page);
    await gesture(page, currentPhoto, 'swipe', [.75, .5]);
    await page.waitForFunction(() => document.querySelector('.pv-info p')?.textContent === 'Another public photo');
    await geometry(page);
    await click(page, 'Previous photo');
    await page.waitForFunction(() => document.querySelector('.pv-info p')?.textContent === 'Public photo');
    await geometry(page);
    await gesture(page, currentPhoto, 'double');
    await page.getByRole('button', { name: 'Enter photo fullscreen', exact: true }).waitFor();
    for (const kind of ['vertical', 'pinch', 'cancel', 'long', 'slow']) { await gesture(page, currentPhoto, kind); await gesture(page, currentPhoto, 'cancel'); }
    assert.equal(await page.locator('.pv-fullscreen').count(), 0);
    await page.locator('.photo-viewer').focus(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.pv-info p')?.textContent === 'Another public photo');
    await page.locator('.pv-stage').dispatchEvent('wheel', { deltaY: -80 });
    await page.waitForFunction(() => document.querySelector('.pv-info p')?.textContent === 'Public photo');
    await click(page, 'Enter photo fullscreen'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.pv-fullscreen').count(), 1, 'Escape does not dismiss fallback viewer');
    await click(page, 'Exit photo fullscreen'); await click(page, 'Close');
    assert.equal(await page.locator('[inert]').count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    assert.deepEqual(page.fixtureErrors, []); await page.close();
    console.log(`PASS ${engine} photo ${width}px: viewport fallback escapes parent, shared toggle, swipe retains fullscreen, controls, keyboard/wheel, pinch and close cleanup`);
  }
  {
    const page = await fixture(); await openPhoto(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      window.photoRequests = 0;
      document.querySelector('.photo-viewer').requestFullscreen = () => { window.photoRequests++; return Promise.reject(new Error('fixture rejection')); };
    });
    await gesture(page, currentPhoto, 'double'); await geometry(page);
    assert.equal(await page.evaluate(() => window.photoRequests), 1);
    await click(page, 'Exit photo fullscreen'); await click(page, 'Close'); await page.close();
    console.log(`PASS ${engine} photo rejected API: complete CSS fullscreen retained, exit/Close available`);
  }
  for (const api of ['standard', 'vendor', 'coalesced', 'delayed']) {
    const page = await fixture(); await openPhoto(page);
    await page.evaluate(api => {
      const root = document.querySelector('.photo-viewer');
      let full = null; window.photoCalls = [];
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => api === 'vendor' ? null : full });
      Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => api === 'vendor' ? full : null });
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: api !== 'vendor' });
      Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: api === 'vendor' });
      const change = value => { full = value; document.dispatchEvent(new Event(api === 'vendor' ? 'webkitfullscreenchange' : 'fullscreenchange')); };
      const enter = () => {
        window.photoCalls.push('enter');
        if (api === 'delayed') return new Promise(resolve => { window.completePhotoEntry = () => { change(root); resolve(); }; });
        // The native property and promise can settle before queued change events.
        // If exit wins that race, both events observe null; entry must still be
        // remembered so a system exit restores the normal viewer.
        if (api === 'coalesced') { full = root; return Promise.resolve(); }
        change(root); return Promise.resolve();
      };
      const exit = () => { window.photoCalls.push('exit'); change(null); return Promise.resolve(); };
      root.requestFullscreen = enter; root.webkitRequestFullscreen = enter;
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: api === 'vendor' ? undefined : exit });
      document.webkitExitFullscreen = exit;
      window.photoSystemExit = () => change(null);
    }, api);
    await gesture(page, currentPhoto, 'double'); await geometry(page);
    await click(page, 'Exit photo fullscreen');
    if (api === 'delayed') await page.evaluate(() => window.completePhotoEntry());
    await page.waitForFunction(() => !document.querySelector('.pv-fullscreen'));
    assert.deepEqual(await page.evaluate(() => window.photoCalls), ['enter', 'exit']);
    await click(page, 'Enter photo fullscreen');
    if (api === 'delayed') {
      await page.evaluate(() => { window.cancelledPhotoEntry = window.completePhotoEntry; });
      await click(page, 'Exit photo fullscreen');
      await click(page, 'Enter photo fullscreen');
      await page.evaluate(() => window.cancelledPhotoEntry());
      assert.equal(await page.getByRole('button', { name: 'Exit photo fullscreen', exact: true }).count(), 1, 'a stale entry must not exit a newer requested fullscreen');
      await page.evaluate(() => window.completePhotoEntry());
      await click(page, 'Exit photo fullscreen');
      await click(page, 'Enter photo fullscreen');
      await click(page, 'Close'); await page.evaluate(() => window.completePhotoEntry());
    } else {
      await page.evaluate(() => window.photoSystemExit());
      await page.getByRole('button', { name: 'Enter photo fullscreen', exact: true }).waitFor();
      await click(page, 'Enter photo fullscreen'); await click(page, 'Close');
    }
    await page.waitForFunction(() => !(document.fullscreenElement ?? document.webkitFullscreenElement));
    assert.equal(await page.locator('.photo-viewer').count(), 0);
    assert.equal(await page.locator('[inert]').count(), 0);
    assert.deepEqual(page.fixtureErrors, []); await page.close();
    console.log(`PASS ${engine} photo ${api}: shared API action, external exit state, late-entry cancellation/Close cleanup`);
  }
  if (engine === 'chromium') {
    const page = await fixture(); await openVideo(page);
    const touchTwice = async selector => {
      const r = await page.locator(selector).boundingBox();
      await page.touchscreen.tap(r.x + r.width * .25, r.y + r.height * .25);
      await page.touchscreen.tap(r.x + r.width * .25, r.y + r.height * .25);
    };
    await touchTwice('video');
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('video-player-surface'));
    await touchTwice('video'); await page.waitForFunction(() => !document.fullscreenElement);
    await click(page, 'Close video player'); await openPhoto(page);
    await touchTwice(currentPhoto); await page.waitForFunction(() => document.fullscreenElement?.classList.contains('photo-viewer'));
    await geometry(page); await touchTwice(currentPhoto); await page.waitForFunction(() => !document.fullscreenElement);
    await click(page, 'Enter photo fullscreen'); await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => document.exitFullscreen());
    await page.getByRole('button', { name: 'Enter photo fullscreen', exact: true }).waitFor();
    await click(page, 'Enter photo fullscreen'); await page.waitForFunction(() => !!document.fullscreenElement);
    await click(page, 'Close'); await page.waitForFunction(() => !document.fullscreenElement);
    assert.deepEqual(page.fixtureErrors, []); await page.close();
    console.log('PASS real Chromium touch events: immediate video/photo API entry, double-tap exits, external exit state, fullscreen Close cleanup');
  }
  if (engine === 'chromium' || engine === 'firefox') {
    const page = await fixture(1440, false); await openVideo(page);
    await page.locator('video').dblclick({ position: { x: 100, y: 30 } });
    try {
      // Firefox's native controls can consume desktop double-click and fullscreen
      // the video itself; preserve that existing behavior alongside our surface.
      await page.waitForFunction(() => {
        const v = document.querySelector('video'), full = document.fullscreenElement;
        return !!v && !!full && (full === v || full.contains(v));
      }, undefined, { timeout: 5000 });
    } catch (error) {
      throw new Error(error.message + ' ' + JSON.stringify(await page.evaluate(() => ({ fullscreen: document.fullscreenElement?.tagName,
        error: document.querySelector('[role="alert"]')?.textContent, buttons: Array.from(document.querySelectorAll('.video-presentation-controls button')).map(b => b.getAttribute('aria-label')) }))));
    }
    await page.locator('video').dblclick({ position: { x: 100, y: 30 } }); await page.waitForFunction(() => !document.fullscreenElement);
    await click(page, 'Enter fullscreen'); await click(page, 'Exit fullscreen'); await click(page, 'Close video player');
    assert.deepEqual(page.fixtureErrors, []); await page.close();
    console.log(`PASS real ${engine} desktop double-click and fullscreen button`);
  }
} finally { await browser.close(); }
