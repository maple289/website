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
  // drawn uncropped with uniform scaling. Hide controls/overlays for pixel
  // comparison, then restore them for UI captures and interaction checks.
  const overlays = await page.locator('.video-player-header, .video-presentation-controls').evaluateAll(elements => elements.map(el => {
    const previous = el.style.visibility; el.style.visibility = 'hidden'; return previous;
  }));
  const restoreOverlays = () => page.locator('.video-player-header, .video-presentation-controls').evaluateAll((elements, values) => {
    elements.forEach((el, i) => { el.style.visibility = values[i]; });
  }, overlays);
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
      await restoreOverlays();
      await page.screenshot({ path: `.runtime/iphone-video-layout/${engine}-${label}-card.png` });
    }
  } finally { await restoreOverlays(); await page.locator('video').evaluate(v => { v.controls = true; }); }
}
try {
  for (const suffix of ['', ' FxiOS/132.0', ' CriOS/132.0']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: iphone + suffix });
    await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/video-frame-edges.mp4' } }));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
      const viewport = new EventTarget();
      Object.assign(viewport, { width: 390, height: 600, offsetTop: 12, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { value: viewport });
      window.setVisibleViewport = values => { Object.assign(viewport, values); viewport.dispatchEvent(new Event('resize')); };
    });
    await page.goto('http://127.0.0.1:5217/tests/public-previews.html');
    await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const original = supabase.rpc.bind(supabase);
      let own = null;
      window.layoutReactionWrites = [];
      supabase.rpc = async (name, args) => {
        if (name === 'get_media_reactions') return { data: args.p_ids.map(id => ({ media_id: id, counts: { lol: 1, ...(own ? { [own]: 1 } : {}) }, own_reaction: own })), error: null };
        if (name === 'set_media_reaction') { own = args.p_reaction; window.layoutReactionWrites.push(own); return { data: null, error: null }; }
        return original(name, args);
      };
    });
    await page.getByRole('button', { name: 'Fixture sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
    await page.waitForFunction(() => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false; v.pause(); return true; });
    // Expose supported presentation buttons without invoking native playback APIs.
    await page.locator('video').evaluate(v => {
      // Keep the three-second fixture alive during the longer layout/picker
      // matrix. Natural-end behavior is covered by video-player-recovery.
      v.loop = true;
      const surface = v.closest('.video-player-surface');
      Object.defineProperty(v, 'webkitSupportsFullscreen', { configurable: true, value: true });
      Object.defineProperty(v, 'webkitEnterFullscreen', { configurable: true, value: () => {} });
      let full = null, pip = null;
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
      Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => pip });
      Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
      Object.defineProperty(v, 'requestPictureInPicture', { configurable: true, value: async () => { pip = v; v.dispatchEvent(new Event('enterpictureinpicture')); } });
      Object.defineProperty(document, 'exitPictureInPicture', { configurable: true, value: async () => { pip = null; v.dispatchEvent(new Event('leavepictureinpicture')); } });
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      surface.requestFullscreen = async () => { full = surface; document.dispatchEvent(new Event('fullscreenchange')); };
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: async () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); } });
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
        const current = () => ({
          card: box('.video-player-surface'), header: box('.video-player-header'), video: box('video'), area: box('.video-playback-area'),
          controls: box('.video-presentation-controls'), reactions: box('.video-reactions'),
          fullscreen: box('[data-video-fullscreen-toggle]'), pip: box('[aria-label="Enter picture-in-picture"]'),
        });
        const geometry = current();
        // Disable only the new landscape media rule to compare with the last
        // working no-crop layout, including an exact portrait regression check.
        const rules = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
          .filter(rule => rule.type === CSSRule.MEDIA_RULE && rule.cssText.includes('--iphone-video-reaction-row'));
        const media = rules.map(rule => rule.media.mediaText);
        let previous;
        try { rules.forEach(rule => { rule.media.mediaText = 'not all'; }); previous = current(); }
        finally { rules.forEach((rule, i) => { rule.media.mediaText = media[i]; }); }
        return { geometry, previous };
      });
      const { geometry: boxes, previous } = geometry;
      if (size.width > 500) {
        assert.ok(boxes.video.height >= previous.video.height + 95, 'landscape recovers the header/control row heights');
        assert.ok(boxes.video.height >= previous.video.height * 1.5, 'landscape video is substantially larger');
        assert.equal(boxes.reactions.height, 48, 'one compact reaction row');
        assert.ok(boxes.controls.bottom <= boxes.area.bottom - 63, 'mode buttons leave the native seek strip clear');
        assert.ok(boxes.header.bottom <= boxes.controls.top + 1, 'header and mode targets do not overlap');
        assert.ok(await page.locator('.video-player-header button, .video-presentation-controls button').evaluateAll(buttons => buttons.every(button => {
          const b = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
        })), 'overlay buttons receive taps above the video');
        console.log(`${engine} ${size.width}x${size.height}: video height ${previous.video.height.toFixed(1)} -> ${boxes.video.height.toFixed(1)}px`);
      } else assert.deepEqual(boxes, previous, 'portrait geometry is unchanged, including after rotation');
      for (const [name, box] of Object.entries(boxes)) {
        assert.ok(box.top >= size.offsetTop - 1 && box.bottom <= size.offsetTop + size.height + 1, `${name} outside visible viewport: ${JSON.stringify({size, geometry})}`);
        assert.ok(box.height > 0, `${name} collapsed`);
      }
      assert.ok(boxes.video.height >= 32, 'video remains visible in short landscape: ' + JSON.stringify({ size, boxes }));
      for (const edge of ['top', 'bottom', 'left', 'right', 'width', 'height']) {
        assert.ok(Math.abs(boxes.video[edge] - boxes.area[edge]) < 1, `video must fit final playback area: ${edge} ${JSON.stringify(boxes)}`);
      }
      assert.deepEqual(await page.locator('video').evaluate(v => [getComputedStyle(v).objectFit, getComputedStyle(v).objectPosition]), ['contain', '50% 50%']);
      await completeFrame(page, `${suffix ? suffix.trim().split('/')[0] : 'Safari'}-${size.width}x${size.height}`);
      assert.ok(boxes.card.scroll <= boxes.card.client + 1, 'card must not scroll title/video away');
      if (size.width > 500) {
        const cardHeight = await page.locator('.video-player-surface').evaluate(el => el.getBoundingClientRect().height);
        await page.locator('.video-reactions .reaction-add').tap();
        await page.getByRole('group', { name: 'Choose your reaction', exact: true }).waitFor();
        const picker = await page.locator('.reaction-bar').boundingBox();
        assert.ok(picker.y + picker.height <= boxes.reactions.top + 3, 'picker opens upward over the media');
        assert.equal(await page.locator('.video-player-surface').evaluate(el => el.getBoundingClientRect().height), cardHeight, 'picker does not enlarge the card');
        // Windows WebKit has desktop focus behavior despite touch emulation;
        // verify keyboard selection there, and actual touch activation in Chromium.
        if (engine === 'webkit') await page.getByRole('button', { name: 'Smile', exact: true }).press('Enter');
        else await page.getByRole('button', { name: 'Smile', exact: true }).tap();
        await page.waitForFunction(() => window.layoutReactionWrites.at(-1) === 'smile', undefined, { timeout: 2000 });
        await page.locator('.video-reactions').getByRole('button', { name: 'Your reaction: Smile. Click to remove', exact: true }).waitFor({ timeout: 2000 }).catch(async error => {
          throw new Error(error.message + ' ' + await page.locator('.video-reactions').innerHTML());
        });
        await page.locator('.video-reactions').getByRole('button', { name: 'Your reaction: Smile. Click to remove', exact: true }).tap();
        await page.locator('.video-reactions').getByRole('button', { name: 'Your reaction: Smile. Click to remove', exact: true }).waitFor({ state: 'hidden' });
        if (size.height === 260) {
          await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).tap();
          await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
          assert.equal(await page.locator('.video-reactions').evaluate(el => getComputedStyle(el).display), 'none', 'fullscreen keeps its existing reaction policy');
          await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).tap();
          await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).waitFor();
          assert.equal(await page.locator('.video-playback-area').evaluate(el => el.getBoundingClientRect().height), boxes.area.height, 'fullscreen exit restores enlarged normal landscape');
          await page.locator('video').evaluate(v => {
            const b = v.getBoundingClientRect();
            const touch = { identifier: 1, target: v, clientX: b.left + b.width * .25, clientY: b.top + b.height * .4 };
            for (let i = 0; i < 2; i++) for (const type of ['touchstart', 'touchend']) {
              const event = new Event(type, { bubbles: true, cancelable: true });
              Object.defineProperties(event, { touches: { value: type === 'touchstart' ? [touch] : [] }, changedTouches: { value: [touch] } });
              v.dispatchEvent(event);
            }
          });
          await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).tap();
          await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Enter picture-in-picture', exact: true }).tap();
          await page.getByRole('button', { name: 'Exit picture-in-picture', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Exit picture-in-picture', exact: true }).tap();
          await page.getByRole('button', { name: 'Enter picture-in-picture', exact: true }).waitFor();
        }
      }
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
    // Fresh playback keeps natural-end behavior separate from our looped layout
    // fixture and from seeking. Close must still happen on the real ended event.
    await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
    await page.locator('.video-player-surface').waitFor();
    await page.locator('.video-player-surface').waitFor({ state: 'hidden', timeout: 8000 });
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
