import assert from 'node:assert/strict';
import * as engines from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createPublicPreviewServer } from './public-previews-server.mjs';

// Use the PNG decoder shipped with the pinned Playwright runtime.
const require = createRequire(import.meta.url);
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
const engine = process.env.BROWSER_ENGINE || 'chromium';

// Desktop emulation verifies layout and viewport events, not native iOS chrome.
const server = await createPublicPreviewServer();
await server.listen();
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

async function completeFrame(page, label) {
  // Compare the rendered playback area against the SAME decoded video frame,
  // drawn uncropped with uniform scaling. Hide native controls only for capture,
  // then restore them before interaction checks. No source or playback changes.
  const source = await page.locator('video').evaluate(v => {
    v.controls = false;
    const area = v.parentElement.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(area.width); canvas.height = Math.round(area.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / v.videoWidth, canvas.height / v.videoHeight);
    const width = v.videoWidth * scale, height = v.videoHeight * scale;
    ctx.drawImage(v, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  try {
    const actualBuffer = await page.locator('.video-playback-area').screenshot();
    const expected = PNG.sync.read(Buffer.from(source, 'base64'));
    const actual = PNG.sync.read(actualBuffer);
    assert.ok(Math.abs(actual.width - expected.width) <= 1 && Math.abs(actual.height - expected.height) <= 1, 'capture rounding is at most one pixel');
    // Tolerate decoder/compositor rounding, but detect lost edges and incorrect
    // contain scaling. Compare the whole image, including its outer strips.
    const regions = { all: [0, 0], top: [0, 0], bottom: [0, 0], left: [0, 0], right: [0, 0] };
    for (let y = 1; y < Math.min(actual.height, expected.height) - 1; y++) for (let x = 1; x < Math.min(actual.width, expected.width) - 1; x++) {
      const i = (y * actual.width + x) * 4;
      const j = (y * expected.width + x) * 4;
      const delta = Math.max(...[0, 1, 2].map(c => Math.abs(actual.data[i + c] - expected.data[j + c])));
      const keys = ['all', ...(y < actual.height * .15 ? ['top'] : []), ...(y > actual.height * .85 ? ['bottom'] : []),
        ...(x < actual.width * .15 ? ['left'] : []), ...(x > actual.width * .85 ? ['right'] : [])];
      for (const key of keys) { regions[key][0] += delta > 35 ? 1 : 0; regions[key][1]++; }
    }
    for (const [edge, [different, total]] of Object.entries(regions)) {
      assert.ok(different / total < .12, `${label}: ${edge} frame differs from uncropped source (${different}/${total})`);
    }
    if (process.env.CAPTURE_IPHONE_LAYOUT) {
      await fs.mkdir('.runtime/iphone-video-layout', { recursive: true });
      await fs.writeFile(`.runtime/iphone-video-layout/${engine}-${label}-actual.png`, actualBuffer);
      await fs.writeFile(`.runtime/iphone-video-layout/${engine}-${label}-source.png`, Buffer.from(source, 'base64'));
      await page.screenshot({ path: `.runtime/iphone-video-layout/${engine}-${label}-card.png` });
    }
  } finally { await page.locator('video').evaluate(v => { v.controls = true; }); }
}
try {
  for (const suffix of ['', ' FxiOS/132.0', ' CriOS/132.0']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: iphone + suffix });
    await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/video-frame-edges.mp4' } }));
    await page.addInitScript(() => {
      const viewport = new EventTarget();
      Object.assign(viewport, { width: 390, height: 600, offsetTop: 12, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { value: viewport });
      window.setVisibleViewport = values => { Object.assign(viewport, values); viewport.dispatchEvent(new Event('resize')); };
    });
    await page.goto('http://127.0.0.1:5217/tests/public-previews.html');
    await page.getByRole('button', { name: 'Fixture sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
    await page.waitForFunction(() => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false; v.pause(); return true; });
    // Expose supported presentation buttons without invoking native playback APIs.
    await page.locator('video').evaluate(v => {
      Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
      Object.defineProperty(v, 'requestPictureInPicture', { configurable: true, value: async () => {} });
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      v.closest('.video-player-surface').requestFullscreen = async () => {};
      v.dispatchEvent(new Event('loadedmetadata'));
    });
    await page.getByRole('button', { name: 'Enter picture-in-picture', exact: true }).waitFor();
    for (const size of [
      { width: 390, height: 600, offsetTop: 12 },
      { width: 390, height: 720, offsetTop: 0 },
      { width: 844, height: 260, offsetTop: 10 },
      { width: 844, height: 330, offsetTop: 0 },
      { width: 320, height: 440, offsetTop: 0 },
      { width: 844, height: 220, offsetTop: 12 },
      { width: 390, height: 600, offsetTop: 12 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.width > 500 ? 390 : 844 });
      await page.evaluate(size => window.setVisibleViewport(size), size);
      await page.waitForFunction(size => document.querySelector('.iphone-video-viewport')?.style.getPropertyValue('--iphone-video-height') === `${size.height}px`, size);
      const geometry = await page.evaluate(() => {
        const box = selector => {
          const el = document.querySelector(selector);
          if (!el) throw new Error('Missing layout element: ' + selector);
          const b = el.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, width: b.width, scroll: el.scrollHeight, client: el.clientHeight };
        };
        return {
          card: box('.video-player-surface'), header: box('.video-player-header'), video: box('video'), area: box('.video-playback-area'),
          controls: box('.video-presentation-controls'), reactions: box('.video-reactions'),
          fullscreen: box('[data-video-fullscreen-toggle]'), pip: box('[aria-label="Enter picture-in-picture"]'),
        };
      });
      for (const [name, box] of Object.entries(geometry)) {
        assert.ok(box.top >= size.offsetTop - 1 && box.bottom <= size.offsetTop + size.height + 1, `${name} outside visible viewport: ${JSON.stringify({size, geometry})}`);
        assert.ok(box.height > 0, `${name} collapsed`);
      }
      assert.ok(geometry.video.height >= 32, 'video remains visible in short landscape: ' + JSON.stringify({ size, geometry }));
      for (const edge of ['top', 'bottom', 'left', 'right', 'width', 'height']) {
        assert.ok(Math.abs(geometry.video[edge] - geometry.area[edge]) < 1, `video must fit final playback area: ${edge} ${JSON.stringify(geometry)}`);
      }
      assert.deepEqual(await page.locator('video').evaluate(v => [getComputedStyle(v).objectFit, getComputedStyle(v).objectPosition]), ['contain', '50% 50%']);
      await completeFrame(page, `${suffix ? suffix.trim().split('/')[0] : 'Safari'}-${size.width}x${size.height}`);
      assert.ok(geometry.card.scroll <= geometry.card.client + 1, 'card must not scroll title/video away');
      // A tall lower section may scroll, while the video/header/buttons stay put.
      await page.locator('.video-reactions').evaluate(el => {
        const extra = document.createElement('div'); extra.dataset.layoutExtra = ''; extra.style.height = '500px'; el.append(extra); el.scrollTop = el.scrollHeight;
      });
      assert.ok(await page.locator('.video-reactions').evaluate(el => el.scrollTop > 0));
      await page.locator('[data-layout-extra]').evaluate(el => el.remove());
    }
    await page.locator('video').evaluate(v => { v.currentTime = .5; });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.seeking && Math.abs(v.currentTime - .5) < .1; });
    await page.locator('video').evaluate(v => { void v.play(); });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > .6; });
    await page.locator('video').evaluate(v => { v.pause(); });
    assert.equal(await page.locator('video').evaluate(v => v.controls), true, 'native controls restored after frame comparison');
    // Existing page fullscreen styling must win; exit returns to normal fitting.
    await page.locator('.video-player-surface').evaluate(surface => { surface.classList.add('video-page-fullscreen'); surface.closest('[data-task-modal]').classList.add('video-page-fullscreen-layer'); });
    assert.equal(await page.locator('.video-player-header').evaluate(el => getComputedStyle(el).position), 'absolute');
    await page.locator('.video-player-surface').evaluate(surface => { surface.classList.remove('video-page-fullscreen'); surface.closest('[data-task-modal]').classList.remove('video-page-fullscreen-layer'); });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.video-player-surface').count(), 1);
    await page.getByRole('button', { name: 'Close video player', exact: true }).click();
    assert.equal(await page.locator('.iphone-video-viewport').count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    await page.close();
    console.log(`PASS ${engine} complete frame/source comparison, rotations, lower scrolling and modal safety: ` + (suffix || 'Safari'));
  }
  for (const userAgent of ['Mozilla/5.0 (Linux; Android 14) Chrome/132.0 Mobile Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0']) {
    const page = await browser.newPage({ userAgent });
    await page.goto('http://127.0.0.1:5217/tests/public-previews.html');
    await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
    await page.locator('.video-player-surface').waitFor();
    assert.equal(await page.locator('.iphone-video-viewport').count(), 0);
    await page.close();
  }
  console.log('PASS Android and desktop excluded');
} finally {
  await browser.close();
  await server.close();
}
