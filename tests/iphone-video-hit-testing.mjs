import assert from 'node:assert/strict';
import * as engines from 'playwright';
import { createPublicPreviewServer } from './public-previews-server.mjs';

const engine = process.env.BROWSER_ENGINE || 'chromium';
const server = await createPublicPreviewServer();
await server.listen();
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

async function open(userAgent, width, height, touch = true) {
  const page = await browser.newPage({ userAgent, hasTouch: touch, viewport: { width, height } });
  await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/video-frame-edges.mp4' } }));
  await page.goto('http://127.0.0.1:5217/tests/public-previews.html');
  await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
  await page.waitForFunction(() => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false; v.pause(); v.loop = true; return true; });
  await page.locator('video').evaluate(v => {
    const surface = v.closest('.video-player-surface');
    let full = null, pip = null;
    window.modeHits = { full: 0, pip: 0 };
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    Object.defineProperty(v, 'webkitSupportsFullscreen', { configurable: true, value: true });
    Object.defineProperty(v, 'webkitEnterFullscreen', { configurable: true, value: () => {} });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    surface.requestFullscreen = async () => { full = surface; window.modeHits.full++; document.dispatchEvent(new Event('fullscreenchange')); };
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: async () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); } });
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => pip });
    Object.defineProperty(v, 'requestPictureInPicture', { configurable: true, value: async () => { pip = v; window.modeHits.pip++; v.dispatchEvent(new Event('enterpictureinpicture')); } });
    Object.defineProperty(document, 'exitPictureInPicture', { configurable: true, value: async () => { pip = null; v.dispatchEvent(new Event('leavepictureinpicture')); } });
    v.dispatchEvent(new Event('loadedmetadata'));
  });
  await page.getByRole('button', { name: 'Enter picture-in-picture', exact: true }).waitFor();
  return page;
}

async function nativeHitRegions(page, label) {
  const result = await page.evaluate(() => {
    const video = document.querySelector('video');
    const box = video.getBoundingClientRect();
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    // Native iOS shadow controls cannot be inspected on a desktop engine. A hit
    // in their top-left host region must reach the video, rather than app UI.
    const points = [[18, 18], [62, 18], [box.width / 2, 18]].map(([x, y]) => {
      const hit = document.elementFromPoint(box.left + x, box.top + y);
      return { x: box.left + x, y: box.top + y, video: hit === video, target: hit?.tagName, className: hit?.getAttribute('class') };
    });
    return { points, geometry: { video: box.toJSON(), header: rect('.video-player-header'), controls: rect('.video-presentation-controls'), reactions: rect('.video-reactions') } };
  });
  assert.ok(result.points.every(p => p.video), label + ': native host region intercepted: ' + JSON.stringify(result));
  return result.geometry;
}

try {
  for (const suffix of ['', ' FxiOS/132.0']) {
    const page = await open(iphone + suffix, 844, 390);
    const geometry = await nativeHitRegions(page, suffix || 'Safari landscape');
    const buttonsReachable = await page.locator('.video-player-header button, .video-presentation-controls button').evaluateAll(buttons => buttons.every(button => {
      const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }));
    assert.equal(buttonsReachable, true, 'only application buttons retain their hit targets');
    await page.locator('.video-presentation-controls').evaluate(controls => {
      const buttons = controls.querySelectorAll('button'), left = buttons[0].getBoundingClientRect(), right = buttons[1].getBoundingClientRect();
      const hit = document.elementFromPoint((left.right + right.left) / 2, left.top + left.height / 2);
      if (hit !== document.querySelector('video')) throw new Error('Mode-bar gap should pass through to video');
      // Check immediately, during the fade, without relying on inert or waiting
      // for visibility:hidden. Hidden descendants must not re-enable input.
      controls.classList.add('video-controls-hidden');
      for (const button of buttons) {
        if (getComputedStyle(button).pointerEvents !== 'none') throw new Error('Hidden mode button intercepts input during fade');
      }
      const b = left;
      if (document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) !== document.querySelector('video')) throw new Error('Fading mode bar intercepts video');
      controls.classList.remove('video-controls-hidden');
    });
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).tap();
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
    assert.equal(await page.locator('.video-player-header').evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'fullscreen header policy is unchanged');
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).tap();
    await page.getByRole('button', { name: 'Enter picture-in-picture', exact: true }).tap();
    await page.getByRole('button', { name: 'Exit picture-in-picture', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Exit picture-in-picture', exact: true }).tap();
    assert.deepEqual(await page.evaluate(() => window.modeHits), { full: 1, pip: 1 });
    assert.deepEqual(await nativeHitRegions(page, 'returned landscape'), geometry, 'mode changes preserve geometry and native hit regions');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.iphone-video-viewport').style.getPropertyValue('--iphone-video-width') === `${innerWidth}px`);
    await nativeHitRegions(page, 'portrait');
    assert.equal(await page.locator('.video-player-header').evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'portrait header remains unchanged');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.querySelector('.iphone-video-viewport').style.getPropertyValue('--iphone-video-width') === `${innerWidth}px`);
    await nativeHitRegions(page, 'rotated landscape');
    await page.getByRole('button', { name: 'Close video player', exact: true }).tap();
    await page.locator('.video-player-surface').waitFor({ state: 'hidden' });
    await page.close();
    console.log(`PASS ${engine} ${suffix || 'Safari'} landscape native host hit testing, fading/visible custom controls, rotation, fullscreen/PiP and Close`);
  }
  for (const ua of ['Mozilla/5.0 (Linux; Android 14) Chrome/132.0 Mobile Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0']) {
    const page = await open(ua, 844, 390, ua.includes('Android'));
    assert.equal(await page.locator('.iphone-video-viewport').count(), 0);
    // Android now owns separate landscape overlays with the same decorative
    // pass-through policy. Desktop keeps its original in-flow hit regions.
    const policy = ua.includes('Android') ? 'none' : 'auto';
    assert.equal(await page.locator('.video-player-header').evaluate(el => getComputedStyle(el).pointerEvents), policy);
    assert.equal(await page.locator('.video-presentation-controls').evaluate(el => getComputedStyle(el).pointerEvents), policy);
    assert.equal(await page.getByRole('button', { name: 'Close video player', exact: true }).evaluate(el => getComputedStyle(el).pointerEvents), 'auto');
    await page.close();
  }
  console.log(`PASS ${engine} Android/desktop excluded from iPhone rules; platform pointer policies retained`);
} finally { await browser.close(); await server.close(); }
