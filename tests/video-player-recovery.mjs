// Ordered recovery checks. Uses real gallery/player and local media only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const requestedPhase = process.env.PLAYER_RECOVERY_PHASE || 'all';
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const base = process.env.TEST_BASE_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const results = [];
async function fixture(nativePresentation) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  if (nativePresentation !== undefined) await page.addInitScript(native => {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true, value: native ? 5 : 0,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitSetPresentationMode', {
      configurable: true, value: native ? () => {} : undefined,
    });
  }, nativePresentation);
  if (engine === 'webkit') await page.route('**/functions/v1/serve-media?*', r => r.fulfill({ json: { url: '/tests/fixtures/playback-ended.mp4' } }));
  await page.goto(base + '/tests/public-previews.html?consumption=1');
  return page;
}
async function open(page) {
  await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
  await page.waitForFunction(() => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false; v.pause(); return true; });
  await page.locator('video').evaluate(v => { window.recoveryVideo = v; window.closeTaps = 0; window.endedEvents = 0; v.addEventListener('ended', () => window.endedEvents++); });
  await page.getByRole('button', { name: 'Close video player', exact: true }).evaluate(b => b.addEventListener('click', () => window.closeTaps++, { capture: true }));
}
async function closed(page) {
  await page.getByRole('dialog', { name: 'Video player', exact: true }).waitFor({ state: 'hidden', timeout: 2000 });
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  assert.equal(await page.locator('[inert]').count(), 0);
  assert.equal(await page.locator('video').count(), 0);
  assert.equal(await page.evaluate(() => window.recoveryVideo.paused), true);
  assert.equal(await page.evaluate(() => window.recoveryVideo.getAttribute('src')), null);
}
async function playToEnd(page) {
  // These cases open a fresh player; play its real media without a setup seek.
  await page.locator('video').evaluate((v, rate) => {
    window.playbackError = null;
    v.playbackRate = rate;
    void v.play().catch(error => { window.playbackError = error.message; });
  }, engine === 'webkit' ? 1 : 4);
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return window.playbackError || !v || (!v.paused && !v.seeking && v.currentTime < v.duration);
  });
  assert.equal(await page.evaluate(() => window.playbackError), null, 'fixture playback must start successfully');
}
async function modes(page, api) {
  await page.locator('video').evaluate((v, api) => {
    const surface = document.querySelector('.video-player-surface');
    let mode = 'inline'; window.modeCalls = []; window.rejectMode = false;
    const define = (object, name, value) => Object.defineProperty(object, name, { configurable: true, writable: true, value });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => api === 'standard' && mode === 'fullscreen' ? surface : null });
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => null });
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => api === 'standard' && mode === 'picture-in-picture' ? v : null });
    define(document, 'fullscreenEnabled', api === 'standard' ? true : undefined);
    define(document, 'webkitFullscreenEnabled', false); define(document, 'pictureInPictureEnabled', api === 'standard');
    Object.defineProperty(v, 'webkitPresentationMode', { configurable: true, get: () => api === 'native' ? mode : undefined });
    Object.defineProperty(v, 'webkitDisplayingFullscreen', { configurable: true, get: () => api === 'native' && mode === 'fullscreen' });
    define(v, 'webkitSupportsFullscreen', api === 'native');
    define(v, 'webkitSupportsPresentationMode', () => api === 'native');
    const change = next => {
      const old = mode; mode = next;
      if (api === 'standard') {
        document.dispatchEvent(new Event('fullscreenchange'));
        if (next === 'picture-in-picture') v.dispatchEvent(new Event('enterpictureinpicture'));
        if (old === 'picture-in-picture') v.dispatchEvent(new Event('leavepictureinpicture'));
      } else {
        if (next === 'fullscreen') v.dispatchEvent(new Event('webkitbeginfullscreen'));
        if (old === 'fullscreen') v.dispatchEvent(new Event('webkitendfullscreen'));
        v.dispatchEvent(new Event('webkitpresentationmodechanged'));
      }
    };
    const request = (name, next, promised) => {
      window.modeCalls.push({ name, next, activation: navigator.userActivation?.isActive ?? true });
      if (window.rejectMode) { if (promised) return Promise.reject(new Error('fixture rejection')); throw new Error('fixture rejection'); }
      change(next); return promised ? Promise.resolve() : undefined;
    };
    window.systemExitMode = () => change('inline');
    surface.requestFullscreen = () => request('standard-fullscreen', 'fullscreen', true);
    document.exitFullscreen = () => request('standard-exit', 'inline', true);
    v.requestPictureInPicture = () => request('standard-pip', 'picture-in-picture', true);
    document.exitPictureInPicture = () => request('standard-pip-exit', 'inline', true);
    define(v, 'webkitEnterFullscreen', api === 'native' ? () => request('native-fullscreen', 'fullscreen', false) : undefined);
    define(v, 'webkitEnterFullScreen', undefined);
    define(v, 'webkitExitFullscreen', api === 'native' ? () => request('native-exit', 'inline', false) : undefined);
    define(v, 'webkitExitFullScreen', undefined);
    define(v, 'webkitSetPresentationMode', api === 'native' ? next => request('native-presentation', next, false) : undefined);
    v.dispatchEvent(new Event('loadedmetadata'));
  }, api);
}
try {
  for (const phase of requestedPhase === 'all' ? ['close', 'ended', 'fullscreen', 'pip', 'combinations', 'desktop'] : [requestedPhase]) {
  if (phase === 'close') {
    if (!process.env.CAPTURE_PLAYER_BASELINE) {
      const page = await fixture();
      const hold = () => {}; // Intentionally leave the media URL request unresolved.
      await page.route('**/functions/v1/serve-media?*', hold);
      await page.getByRole('button', { name: 'Play Public video', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Video player', exact: true });
      await dialog.waitFor();
      assert.equal(await page.locator('video').count(), 0);
      await page.getByRole('button', { name: 'Close video player', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 2000 });
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.equal(await page.locator('[inert]').count(), 0);
      await page.unroute('**/functions/v1/serve-media?*', hold);
      await open(page); await page.getByRole('button', { name: 'Close video player', exact: true }).click(); await closed(page);
      console.log(`PASS ${engine} Close: media URL loading, unmounted and reopened`);
      await page.close();
    }
    for (const condition of ['normal', 'paused', 'buffering', 'rejected-exits', 'silent-native-entry', 'hung-standard-entry']) {
      const page = await fixture(); await open(page);
      if (condition === 'normal') await page.locator('video').evaluate(v => v.play());
      if (condition === 'buffering') await page.locator('video').evaluate(v => { v.dispatchEvent(new Event('waiting')); v.dispatchEvent(new Event('stalled')); });
      if (condition === 'rejected-exits') await page.locator('video').evaluate(v => {
        window.exitAttempts = [];
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => v });
        Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => v });
        document.exitFullscreen = () => { window.exitAttempts.push('fullscreen'); return Promise.reject(new Error('fixture rejection')); };
        document.exitPictureInPicture = () => { window.exitAttempts.push('pip'); return Promise.reject(new Error('fixture rejection')); };
        Object.defineProperty(v, 'webkitDisplayingFullscreen', { configurable: true, value: true });
        Object.defineProperty(v, 'webkitSetPresentationMode', { configurable: true, value: () => { throw new Error('fixture native rejection'); } });
        Object.defineProperty(v, 'webkitExitFullscreen', { configurable: true, value: () => { throw new Error('fixture native rejection'); } });
        Object.defineProperty(v, 'webkitExitFullScreen', { configurable: true, value: undefined });
      });
      if (condition === 'silent-native-entry' || condition === 'hung-standard-entry') {
        await page.locator('video').evaluate((v, condition) => {
          const surface = document.querySelector('.video-player-surface');
          Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
          Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => null });
          Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: condition === 'hung-standard-entry' });
          Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: false });
          Object.defineProperty(v, 'webkitSupportsPresentationMode', { configurable: true, value: () => true });
          Object.defineProperty(v, 'webkitSupportsFullscreen', { configurable: true, value: true });
          for (const name of ['webkitEnterFullscreen', 'webkitEnterFullScreen']) Object.defineProperty(v, name, { configurable: true, value: undefined });
          Object.defineProperty(v, 'webkitSetPresentationMode', { configurable: true, value: () => {} });
          surface.requestFullscreen = () => new Promise(() => {});
          v.dispatchEvent(new Event('loadedmetadata'));
        }, condition);
        await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      }
      const closeButton = page.getByRole('button', { name: 'Close video player', exact: true });
      const hit = await closeButton.evaluate(b => { const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      assert.equal(hit, true, 'Close receives taps without an overlay blocking it');
      await closeButton.click();
      try {
        await closed(page);
        assert.equal(await page.evaluate(() => window.closeTaps), 1);
        if (condition === 'rejected-exits') assert.deepEqual(await page.evaluate(() => window.exitAttempts.sort()), ['fullscreen', 'pip']);
        results.push({ condition, passed: true });
        await open(page); await page.getByRole('button', { name: 'Close video player', exact: true }).click(); await closed(page);
        console.log(`PASS ${engine} Close: ${condition}, tap received, unmounted, scroll/focus cleanup, reopen`);
      } catch (error) {
        results.push({ condition, passed: false, diagnostic: await page.evaluate(() => ({ clicks: window.closeTaps,
          modalPresent: !!document.querySelector('[aria-label="Video player"]'),
          disabled: document.querySelector('[aria-label="Close video player"]')?.disabled,
          error: document.querySelector('[role="alert"]')?.textContent,
          sourceRetained: !!window.recoveryVideo?.getAttribute('src'), attempts: window.exitAttempts })) });
        if (!process.env.CAPTURE_PLAYER_BASELINE) throw error;
      }
      await page.close();
    }
  } else if (phase === 'ended') {
    for (const condition of ['normal', 'rejected-exit', 'silent-entry', 'hung-entry', 'undelivered-ended']) {
      const page = await fixture(); await open(page);
      if (condition === 'rejected-exit') await page.locator('video').evaluate(v => {
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => v });
        document.exitFullscreen = () => Promise.reject(new Error('fixture exit rejection'));
      });
      if (condition === 'silent-entry' || condition === 'hung-entry') {
        await page.locator('video').evaluate((v, condition) => {
          Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: condition === 'hung-entry' });
          Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: false });
          for (const name of ['webkitEnterFullscreen', 'webkitEnterFullScreen']) Object.defineProperty(v, name, { configurable: true, value: undefined });
          Object.defineProperty(v, 'webkitSupportsPresentationMode', { configurable: true, value: () => true });
          Object.defineProperty(v, 'webkitSetPresentationMode', { configurable: true, value: () => {} });
          document.querySelector('.video-player-surface').requestFullscreen = () => new Promise(() => {});
          v.dispatchEvent(new Event('loadedmetadata'));
        }, condition);
        await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      }
      if (condition === 'undelivered-ended') await page.locator('video').evaluate(v => {
        v.addEventListener('ended', event => { window.endedEvents++; event.stopImmediatePropagation(); }, { capture: true });
      });
      await playToEnd(page); await page.waitForFunction(() => window.endedEvents === 1);
      if (condition === 'undelivered-ended') {
        assert.ok(await page.getByRole('dialog', { name: 'Video player', exact: true }).isVisible());
        await page.getByRole('button', { name: 'Close video player', exact: true }).click();
      }
      await closed(page);
      await open(page); await page.getByRole('button', { name: 'Close video player', exact: true }).click(); await closed(page);
      console.log(`PASS ${engine} natural ended: ${condition}, ${condition === 'undelivered-ended' ? 'manual Close after withheld event' : 'direct event auto-close'}, cleanup/reopen`);
      await page.close();
    }
    for (const native of [false, true]) {
      const page = await fixture(native);
      await open(page);
      await page.locator('video').evaluate(v => {
        Object.defineProperty(v, 'duration', { configurable: true, value: 10 });
        Object.defineProperty(v, 'currentTime', { configurable: true, value: 10 });
        Object.defineProperty(v, 'ended', { configurable: true, value: true });
        v.dispatchEvent(new Event('seeking'));
        v.dispatchEvent(new Event('ended'));
      });
      if (native) await closed(page);
      else {
        assert.ok(await page.getByRole('dialog', { name: 'Video player', exact: true }).isVisible(), 'non-native seek-to-end behavior is preserved');
        await page.getByRole('button', { name: 'Close video player', exact: true }).click(); await closed(page);
      }
      console.log(`PASS ${engine}: ${native ? 'native seeking before real ended closes' : 'non-native seek-to-end remains open'}`);
      await page.close();
    }
    for (const eventName of ['webkitendfullscreen', 'webkitpresentationmodechanged']) {
      const page = await fixture(true);
      await open(page);
      await page.locator('video').evaluate((v, eventName) => {
        v.dispatchEvent(new Event(eventName));
      }, eventName);
      assert.ok(await page.getByRole('dialog', { name: 'Video player', exact: true }).isVisible(), 'native mode change before completion must not close');
      await page.locator('video').evaluate((v, eventName) => {
        window.completedNativeVideo = v;
        Object.defineProperty(v, 'ended', { configurable: true, value: true });
        v.dispatchEvent(new Event(eventName));
      }, eventName);
      await closed(page);
      await open(page);
      await page.evaluate(eventName => {
        Object.defineProperty(window.completedNativeVideo, 'ended', { configurable: true, value: true });
        window.completedNativeVideo.dispatchEvent(new Event(eventName));
      }, eventName);
      assert.ok(await page.getByRole('dialog', { name: 'Video player', exact: true }).isVisible(), 'detached video events must not close a reopened player');
      await page.getByRole('button', { name: 'Close video player', exact: true }).click(); await closed(page);
      console.log(`PASS ${engine}: ${eventName} recovers real completion, preserves active playback and removes stale listeners`);
      await page.close();
    }
  } else if (phase === 'fullscreen' || phase === 'pip') {
    if (phase === 'fullscreen') {
      // Mobile WebKit can expose container and legacy methods while native
      // video presentation is the supported path. It must work on the first tap.
      const page = await fixture(); await open(page); await modes(page, 'native');
      await page.locator('video').evaluate(v => {
        // Windows WebKit touch emulation does not expose iPhone touch hardware.
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
        Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
        document.querySelector('.video-player-surface').requestFullscreen = () => {
          window.modeCalls.push({ name: 'container-noop', next: 'inline', activation: navigator.userActivation?.isActive ?? true });
          return Promise.resolve();
        };
        v.webkitEnterFullscreen = () => { throw new Error('legacy native entry unavailable before presentation'); };
        v.dispatchEvent(new Event('loadedmetadata'));
      });
      const button = name => page.getByRole('button', { name, exact: true });
      await button('Enter fullscreen').click();
      assert.deepEqual(await page.evaluate(() => window.modeCalls.map(c => c.name)), ['native-presentation']);
      await button('Exit fullscreen').waitFor();
      assert.equal(await page.locator('video').evaluate(v => v.webkitPresentationMode), 'fullscreen');
      assert.ok(await page.evaluate(() => window.modeCalls.every(c => c.activation)));
      await button('Exit fullscreen').click(); await button('Enter fullscreen').waitFor();
      await button('Enter fullscreen').click(); await button('Exit fullscreen').waitFor();
      assert.deepEqual(await page.evaluate(() => window.modeCalls.map(c => c.next)), ['fullscreen', 'inline', 'fullscreen']);
      await button('Close video player').click(); await closed(page);
      console.log(`PASS ${engine} mobile Fullscreen: native video API on first tap, no PiP prerequisite, exit/re-entry`);
      await page.close();
    }
    for (const api of ['standard', 'native']) {
      const page = await fixture(); await open(page); await modes(page, api);
      const mode = phase === 'fullscreen' ? 'fullscreen' : 'picture-in-picture';
      const button = name => page.getByRole('button', { name, exact: true });
      await button('Enter ' + mode).click(); await button('Exit ' + mode).waitFor();
      await button('Exit ' + mode).click(); await button('Enter ' + mode).waitFor();
      const calls = await page.evaluate(() => window.modeCalls);
      assert.deepEqual(calls.map(c => c.next), [mode, 'inline']);
      assert.ok(calls.every(c => c.activation));
      assert.equal(await page.locator('video').evaluate(v => v.controls), true, 'native playback controls are retained');
      await button('Close video player').click(); await closed(page);
      await open(page); await modes(page, api); await page.evaluate(() => { window.rejectMode = true; });
      await button('Enter ' + mode).click(); await page.getByRole('alert').waitFor();
      await button('Close video player').click(); await closed(page);
      console.log(`PASS ${engine} ${phase}: ${api}, direct gesture, exit, rejection cannot block Close`);
      await page.close();
    }
    if (phase === 'pip') {
      const page = await fixture(); await open(page);
      await page.locator('video').evaluate(v => {
        Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: false });
        Object.defineProperty(v, 'webkitSupportsPresentationMode', { configurable: true, value: () => false });
        v.dispatchEvent(new Event('loadedmetadata'));
      });
      await page.getByRole('button', { name: 'Enter picture-in-picture', exact: true }).waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Close video player', exact: true }).click(); await closed(page);
      console.log(`PASS ${engine}: unsupported programmatic PiP hidden; normal playback/Close independent`);
      await page.close();
    }
  } else if (phase === 'combinations') {
    for (const api of ['standard', 'native']) {
      const page = await fixture(); await open(page); await modes(page, api);
      const button = name => page.getByRole('button', { name, exact: true });
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const mode of ['fullscreen', 'fullscreen', 'picture-in-picture', 'fullscreen', 'picture-in-picture']) {
          await button('Enter ' + mode).click(); await button('Exit ' + mode).waitFor();
          await page.setViewportSize({ width: 844, height: 390 }); await page.setViewportSize({ width: 390, height: 844 });
          await button('Exit ' + mode).click(); await button('Enter ' + mode).waitFor();
        }
      }
      assert.deepEqual(await page.evaluate(() => window.modeCalls.map(c => c.next)), Array.from({ length: 3 }, () => ['fullscreen','inline','fullscreen','inline','picture-in-picture','inline','fullscreen','inline','picture-in-picture','inline']).flat());
      await button('Enter fullscreen').click(); await button('Exit fullscreen').waitFor();
      await page.evaluate(() => window.systemExitMode()); await button('Enter fullscreen').waitFor();
      await button('Close video player').click(); await closed(page);
      for (const mode of ['fullscreen', 'picture-in-picture']) {
        await open(page); await modes(page, api);
        await button('Enter ' + mode).click(); await button('Exit ' + mode).waitFor();
        await playToEnd(page); await page.waitForFunction(() => window.endedEvents === 1); await closed(page);
        assert.equal(await page.evaluate(() => document.fullscreenElement), null);
        assert.equal(await page.evaluate(() => document.pictureInPictureElement), null);
      }
      console.log(`PASS ${engine} combinations: ${api}, repeated modes, rotation, system exit, natural end in fullscreen/PiP`);
      await page.close();
    }
  } else if (phase === 'desktop') {
    if (engine === 'chromium' || engine === 'firefox') {
      const page = await fixture(); await page.setViewportSize({ width: 1280, height: 800 }); await open(page);
      const button = name => page.getByRole('button', { name, exact: true });
      for (let repeat = 0; repeat < 2; repeat++) {
        await button('Enter fullscreen').click();
        await page.waitForFunction(() => document.fullscreenElement?.classList.contains('video-player-surface'));
        const geometry = await page.locator('.video-player-surface').evaluate(surface => {
          const rect = surface.getBoundingClientRect();
          return { width: rect.width, height: rect.height, vw: innerWidth, vh: innerHeight, fit: getComputedStyle(surface.querySelector('video')).objectFit };
        });
        assert.ok(Math.abs(geometry.width - geometry.vw) < 1);
        assert.ok(Math.abs(geometry.height - geometry.vh) < 1);
        assert.equal(geometry.fit, 'contain');
        await button('Exit fullscreen').click(); await page.waitForFunction(() => !document.fullscreenElement);
      }
      await button('Enter fullscreen').click(); await button('Exit fullscreen').waitFor();
      await playToEnd(page); await closed(page);
      await page.waitForFunction(() => !document.fullscreenElement);
      console.log(`PASS actual ${engine} container fullscreen: first tap, viewport layout, repeated exit/re-entry, natural end`);
      await page.close();
    }
  } else throw new Error('Unknown recovery phase: ' + phase);
  }
  if (process.env.CAPTURE_PLAYER_BASELINE) {
    await fs.writeFile(`.runtime/player-regression-before-${engine}.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
    assert.ok(results.every(r => r.passed), 'captured expected baseline close regression');
  }
} finally { await browser.close(); }
