import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5216';
let checks = 0;
try {
  for (const [name, width, height, touch] of [['Desktop', 1440, 900, false], ['Tablet', 768, 1024, true], ['Phone', 390, 844, true], ['Phone landscape', 844, 390, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__captureRequests = 0;
      navigator.mediaDevices.getUserMedia = () => {
        window.__captureRequests++;
        return new Promise(resolve => { window.__allowCapture = () => resolve(new MediaStream()); });
      };
      // Simulate an optional device enumeration that never resolves.
      navigator.mediaDevices.enumerateDevices = () => new Promise(() => {});
    });
    let incoming = false, ended = false, accepts = 0;
    const call = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', conversation_id: 'conversation', caller_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      caller_name: 'Caller fixture', name: 'Conversation fixture', media: 'voice', state: 'ringing', my_state: 'invited', mine: false, seen: false,
      started_at: new Date().toISOString(), answered_at: null, ended_at: null, duration: 0, outcome: null,
      members: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Caller fixture', state: 'joined' }, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Recipient fixture', state: 'invited' }] };
    await page.route('https://call-ui-test.supabase.co/**', async route => {
      const body = route.request().postDataJSON() || {};
      if (route.request().url().includes('/functions/v1/messenger-calls')) return route.fulfill({ json: body.action === 'configuration'
        ? { configured: true, maxParticipants: 4 } : { iceServers: [], expiresAt: Date.now() + 3600000 } });
      let result = null;
      switch (body.p_action) {
        case 'inbox': result = incoming ? [ended ? { ...call, state: 'ended', my_state: 'left' } : call] : []; break;
        case 'accept': accepts++; call.my_state = 'joined'; call.state = 'active'; call.answered_at = new Date().toISOString(); result = call; break;
        case 'end': ended = true; result = { ...call, state: 'ended', my_state: 'left' }; break;
        case 'heartbeat': result = ended ? { ...call, state: 'ended', my_state: 'left' } : call; break;
        case 'signals': result = []; break;
      }
      return route.fulfill({ json: result });
    });
    await page.goto(base + '/tests/messenger-call-ui.html');
    await page.getByRole('button', { name: 'Open edit form', exact: true }).click();
    await page.getByRole('textbox', { name: 'Draft' }).fill('Unsaved work');
    await page.getByRole('button', { name: 'Open nested confirmation' }).click();
    await page.getByRole('alertdialog', { name: 'Fixture confirmation' }).waitFor();
    incoming = true;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('messenger-call')));
    const dialog = page.getByRole('dialog', { name: 'Caller fixture' });
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(node => !!node.closest('[inert]')), false, 'global call must not inherit a lower dialog background lock');
    assert.equal(await page.getByRole('alertdialog', { name: 'Fixture confirmation', includeHidden: true }).evaluate(node => !!node.closest('[inert]')), true);
    if (touch) await dialog.getByRole('button', { name: 'Accept', exact: true }).tap();
    else await dialog.getByRole('button', { name: 'Accept', exact: true }).click();
    await dialog.getByRole('button', { name: 'Connecting…' }).waitFor();
    assert.equal(await page.evaluate(() => window.__captureRequests), 1);
    assert.equal(accepts, 0, 'server Accept waits for permission');
    await page.keyboard.press('Escape'); await page.mouse.click(1, 1); assert.ok(await dialog.isVisible());
    await page.evaluate(() => window.__allowCapture());
    await dialog.waitFor({ state: 'detached' }); assert.equal(accepts, 1);
    const lower = page.getByRole('alertdialog', { name: 'Fixture confirmation' });
    await lower.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Unsaved work');
    await page.getByRole('button', { name: 'Close edit form', exact: true }).click();
    await page.getByRole('button', { name: 'End call', exact: true }).click();
    await page.getByRole('button', { name: 'End call', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.locator('[inert]').count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    checks++; console.log(`PASS ${name}: Accept works over nested dialogs; permission requested once; draft and focus restored; no overflow`);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`${checks} call UI profiles passed (browser emulation, not physical-device media tests).`);
