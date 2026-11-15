import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPublicPreviewServer } from './public-previews-server.mjs';

// Desktop emulation verifies layout and viewport events, not native iOS chrome.
const server = await createPublicPreviewServer();
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
try {
  for (const suffix of ['', ' FxiOS/132.0', ' CriOS/132.0']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: iphone + suffix });
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
      v.requestPictureInPicture = async () => {};
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      v.dispatchEvent(new Event('loadedmetadata'));
    });
    for (const size of [
      { width: 390, height: 600, offsetTop: 12 },
      { width: 390, height: 720, offsetTop: 0 },
      { width: 844, height: 260, offsetTop: 10 },
      { width: 844, height: 330, offsetTop: 0 },
      { width: 320, height: 440, offsetTop: 0 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.width > 500 ? 390 : 844 });
      await page.evaluate(size => window.setVisibleViewport(size), size);
      await page.waitForFunction(size => document.querySelector('.iphone-video-viewport')?.style.getPropertyValue('--iphone-video-height') === `${size.height}px`, size);
      const geometry = await page.evaluate(() => {
        const box = selector => {
          const el = document.querySelector(selector), b = el.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, height: b.height, width: b.width, scroll: el.scrollHeight, client: el.clientHeight };
        };
        return {
          card: box('.video-player-surface'), header: box('.video-player-header'), video: box('video'),
          controls: box('.video-presentation-controls'), reactions: box('.video-reactions'),
          fullscreen: box('[data-video-fullscreen-toggle]'), pip: box('[aria-label="Enter picture-in-picture"]'),
        };
      });
      for (const [name, box] of Object.entries(geometry)) {
        assert.ok(box.top >= size.offsetTop - 1 && box.bottom <= size.offsetTop + size.height + 1, `${name} outside visible viewport: ${JSON.stringify({size, geometry})}`);
        assert.ok(box.height > 0, `${name} collapsed`);
      }
      assert.ok(geometry.video.height >= 80, 'video remains usable in short landscape');
      assert.ok(geometry.card.scroll <= geometry.card.client + 1, 'card must not scroll title/video away');
      // A tall lower section may scroll, while the video/header/buttons stay put.
      await page.locator('.video-reactions').evaluate(el => {
        const extra = document.createElement('div'); extra.dataset.layoutExtra = ''; extra.style.height = '500px'; el.append(extra); el.scrollTop = el.scrollHeight;
      });
      assert.ok(await page.locator('.video-reactions').evaluate(el => el.scrollTop > 0));
      await page.locator('[data-layout-extra]').evaluate(el => el.remove());
    }
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
    console.log('PASS iPhone layout, orientation, lower scrolling and modal safety: ' + (suffix || 'Safari'));
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
