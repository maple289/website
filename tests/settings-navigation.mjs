import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187';
let checks = 0;
const errors = [];
const contexts = [];
const pass = label => { checks++; console.log('PASS ' + label); };
async function setup(source = '#/photos', mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  let profile = { first_name: 'Alex', last_name: 'Original' };
  await page.route('https://settings-test.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/rpc/update_profile_names')) {
      const body = route.request().postDataJSON();
      profile = { first_name: body.p_first_name, last_name: body.p_last_name };
      return route.fulfill({ json: null });
    }
    if (url.pathname.endsWith('/profiles')) return route.fulfill({ json: profile });
    if (url.pathname.endsWith('/photos')) return route.fulfill({ json: [{ id: 'photo-1', owner_id: '11111111-1111-4111-8111-111111111111', file_name: 'Fixture photo', storage_path: 'fixture/photo.jpg', thumbnail_path: '', preview_path: '', visibility: 'private', created_at: '2026-01-01', file_size: 1 }] });
    return route.fulfill({ json: [] });
  });
  await page.goto(base + '/tests/settings-navigation.html' + source);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('First Name').waitFor();
  await page.waitForFunction(() => document.querySelector('input[autocomplete="given-name"]')?.value === 'Alex');
  return page;
}
async function hash(page, expected) { await page.waitForFunction(value => location.hash === value, expected); }
async function source(page, expected) { await hash(page, expected); await page.locator('[data-testid="source"]').waitFor(); }
async function change(page) { await page.getByLabel('First Name').fill('Unsaved'); }
async function back(page) { await page.evaluate(() => history.back()); }
async function warning(page) { try { await page.getByRole('alertdialog').waitFor(); await hash(page, '#/settings'); } catch (error) { console.log('Navigation failure', await page.evaluate(() => ({ hash: location.hash, history: history.state, firstName: document.querySelector('input[autocomplete="given-name"]')?.value, dialogs: document.querySelectorAll('[aria-modal="true"]').length }))); throw error; } }
async function keep(page) { await page.getByRole('button', { name: 'Keep Editing', exact: true }).click(); await page.getByRole('alertdialog').waitFor({ state: 'detached' }); }
async function discard(page) { await page.getByRole('button', { name: 'Discard Changes', exact: true }).click(); }
try {
  for (const origin of ['#/library', '#/photos', '#/files?folder=Documents']) {
    for (const method of ['Back', 'Escape']) {
      const page = await setup(origin);
      const length = await page.evaluate(() => history.length);
      await page.getByLabel('First Name').focus();
      if (method === 'Back') await back(page); else await page.keyboard.press('Escape');
      await source(page, origin);
      assert.equal(await page.evaluate(() => history.length), length);
      pass(origin + ' clean ' + method + ' preserves history length');
      await page.evaluate(() => history.forward()); await hash(page, '#/settings');
      await page.getByLabel('First Name').waitFor();
      await change(page);
      if (method === 'Back') await back(page); else await page.keyboard.press('Escape');
      await warning(page);
      await page.mouse.click(2, 2); await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('alertdialog').count(), 1);
      await keep(page);
      assert.equal(await page.getByLabel('First Name').inputValue(), 'Unsaved');
      pass(origin + ' dirty ' + method + ' Keep Editing/overlay/Escape');
      if (method === 'Back') await back(page); else await page.keyboard.press('Escape');
      await warning(page); await discard(page); await source(page, origin);
      assert.equal(await page.evaluate(() => history.length), length);
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => history.forward()); await hash(page, '#/settings'); await page.getByLabel('First Name').waitFor();
        await back(page); await source(page, origin);
      }
      pass(origin + ' discard and repeated Back/Forward without loops');
      await page.close();
    }
  }
  for (const method of ['Back', 'Escape']) {
    const page = await setup();
    await change(page); await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Profile saved.' }).waitFor();
    if (method === 'Back') await back(page); else await page.keyboard.press('Escape');
    await source(page, '#/photos'); pass('profile save resets dirty: ' + method);
    await page.close();
  }
  {
    const page = await setup('#/library');
    await page.getByLabel('First Name').fill('temporary'); await page.getByLabel('First Name').fill('Alex');
    await page.getByRole('button', { name: 'Change Password', exact: true }).click();
    await page.keyboard.press('Escape'); await source(page, '#/library');
    pass('reverted values and opening password section are clean'); await page.close();
  }
  for (const method of ['Back', 'Escape']) {
    const page = await setup('#/files', true);
    await page.getByRole('button', { name: 'Change Password', exact: true }).click();
    await page.getByLabel('Current Password', { exact: true }).fill('old-fixture');
    await page.getByLabel('New Password', { exact: true }).fill('new-fixture');
    await page.getByLabel('Confirm New Password', { exact: true }).fill('new-fixture');
    if (method === 'Back') await back(page); else await page.keyboard.press('Escape');
    await warning(page); await keep(page);
    assert.equal(await page.getByLabel('New Password', { exact: true }).inputValue(), 'new-fixture');
    await page.locator('button[type="submit"]').filter({ hasText: 'Change Password' }).click();
    await page.getByText('Your password has been changed successfully.').waitFor();
    if (method === 'Back') await back(page); else await page.keyboard.press('Escape');
    await source(page, '#/files'); pass('mobile password dirty/save: ' + method); await page.close();
  }
  {
    const page = await setup('#/photos');
    await back(page); await source(page, '#/photos');
    await page.locator('.mg-thumbnail').click();
    await page.getByRole('dialog', { name: 'Photo viewer' }).waitFor();
    // The modal blocks background menus; a route change represents navigation
    // from an explicit viewer Settings action/deep link without faking state.
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.getByLabel('First Name').waitFor();
    await back(page);
    await page.getByRole('dialog', { name: 'Photo viewer' }).waitFor();
    assert.equal(await page.locator('.pv-info p').textContent(), 'Fixture photo');
    pass('Back restores the same real photo viewer'); await page.close();
  }
  {
    const page = await setup('#/files');
    await back(page); await source(page, '#/files');
    await page.getByRole('button', { name: 'Open folder' }).click(); await hash(page, '#/files?folder=Documents');
    await page.getByRole('link', { name: 'Settings', exact: true }).click(); await change(page);
    const length = await page.evaluate(() => history.length);
    await back(page); await warning(page);
    for (let i = 0; i < 3; i++) { await back(page); await hash(page, '#/settings'); await page.waitForTimeout(100); }
    assert.equal(await page.getByRole('alertdialog').count(), 1);
    await keep(page); assert.equal(await page.getByLabel('First Name').inputValue(), 'Unsaved');
    await page.evaluate(() => history.go(-2)); await warning(page); await discard(page); await source(page, '#/files');
    assert.equal(await page.evaluate(() => history.length), length);
    await page.evaluate(() => history.go(2)); await hash(page, '#/settings'); await page.getByLabel('First Name').waitFor();
    await back(page); await source(page, '#/files?folder=Documents');
    pass('real folder history, repeated Back during warning, multi-entry traversal'); await page.close();
  }
  {
    const page = await setup('#/library');
    await page.evaluate(() => { location.hash = '#/photos'; }); await source(page, '#/photos');
    await back(page); await hash(page, '#/settings'); await change(page);
    await page.evaluate(() => history.forward()); await warning(page); await keep(page);
    await page.evaluate(() => history.forward()); await warning(page); await discard(page); await source(page, '#/photos');
    await back(page); await hash(page, '#/settings'); await page.getByLabel('First Name').waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await source(page, '#/library');
    pass('dirty Forward uses its original target; header Back uses previous page'); await page.close();
  }
  {
    const page = await setup('#/photos');
    await page.route('**/rpc/update_profile_names', route => route.fulfill({ status: 500, json: { message: 'Fixture save failure' } }));
    await page.getByLabel('Last Name').fill('Changed');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Could not save your profile' }).waitFor();
    await back(page); await warning(page); await keep(page);
    assert.equal(await page.getByLabel('Last Name').inputValue(), 'Changed');
    pass('failed save retains last-name draft and dirty state'); await page.close();
  }
  {
    const page = await setup('#/library');
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    await page.route('**/rpc/update_profile_names', async route => { await delayed; await route.fulfill({ json: null }); });
    await change(page); await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
    await back(page); await hash(page, '#/settings'); await page.waitForTimeout(100);
    assert.equal(await page.getByRole('alertdialog').count(), 0);
    release(); await page.getByRole('status').filter({ hasText: 'Profile saved.' }).waitFor();
    await back(page); await source(page, '#/library');
    pass('in-flight save blocks departure; successful completion allows Back'); await page.close();
  }
  assert.deepEqual(errors, []);
  pass('no browser runtime errors');
  console.log(checks + ' checks passed');
} finally { await Promise.all(contexts.map(context => context.close())); await browser.close(); }
