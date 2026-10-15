import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const base = process.env.TEST_BASE_URL;
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
const browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' && process.env.BROWSER_CHANNEL && process.env.BROWSER_CHANNEL !== 'chromium' ? { channel: process.env.BROWSER_CHANNEL } : {}) });
await mkdir('.runtime', { recursive: true });
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + engine + ' ' + label); };
try {
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: engine !== 'firefox' && width < 1024 });
    const page = await context.newPage(), errors = [];
    let baseline = '2026-10-14T12:00:00+00:00', count = 5, activity = 2, writes = 0, reads = 0, fail = false, navigations = 0, holdOverview = false, releaseOverview;
    page.on('pageerror', error => errors.push(error.message));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    const overview = () => ({
      overview: { users: 2, videos: 1, photos: 1, files: 1, video_views: count, photo_views: 0, file_previews: 0, file_downloads: 0, uploads_today: 0, uploads_week: 0, uploads_month: 0 },
      series: [{ date: '2026-10-15', video_views: count, photo_views: 0, file_views: 0, video_uploads: 0, photo_uploads: 0, file_uploads: 0 }],
      top: { video: count ? [{ id: 'video', label: 'Retained video', value: count }] : [], photo: [], file: [] },
      distribution: [], file_types: [], storage_by_user: [], largest_files: [], storage: null, user: null,
      statistics_since: baseline, tracking_started_at: '2026-10-01T00:00:00Z', generated_at: new Date().toISOString(), timezone: 'UTC',
    });
    await page.route('https://upload-test.supabase.co/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith('/rpc/is_admin')) return route.fulfill({ json: !page.url().includes('?regular') });
      if (path.endsWith('/rpc/admin_reset_statistics')) {
        assert.equal(request.method(), 'POST'); assert.equal(request.headers().authorization, 'Bearer fixture');
        assert.ok(!request.postData() || Object.keys(request.postDataJSON() ?? {}).length === 0);
        writes++;
        await new Promise(resolve => setTimeout(resolve, 200));
        if (fail) return route.fulfill({ status: 500, json: { code: 'XX000', message: 'Fixture failure' } });
        baseline = '2026-10-15T12:00:00+00:00'; count = 0; activity = 0;
        return route.fulfill({ json: { statistics_since: baseline } });
      }
      if (path.endsWith('/rpc/admin_analytics')) {
        reads++;
        const section = request.postDataJSON().p_section;
        if (section === 'overview') {
          const snapshot = overview();
          if (holdOverview) { holdOverview = false; await new Promise(resolve => { releaseOverview = resolve; }); }
          return route.fulfill({ json: snapshot });
        }
        const rows = section === 'activity' && activity ? [{ id: 1, occurred_at: baseline, username: 'Fixture member', action: 'viewed', content_type: 'video', name: 'Retained video' }] : [];
        return route.fulfill({ json: { rows, total: rows.length, page: 0, page_size: 25, statistics_since: baseline } });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(base + '/tests/admin-statistics-reset.html');
    await page.getByRole('heading', { name: 'User Accounts', exact: true }).waitFor();
    if (width < 1024) await page.getByRole('button', { name: 'Open admin navigation' }).click();
    await page.getByRole('button', { name: 'Statistics', exact: true }).click();
    const resetButton = page.getByRole('button', { name: 'Reset All Statistics', exact: true });
    const top = page.locator('.analytics-panel').filter({ has: page.getByRole('heading', { name: 'Most viewed content', exact: true }) });
    await top.getByText('Retained video', { exact: true }).waitFor();
    if (width === 390) await page.screenshot({ path: `.runtime/admin-statistics-${engine}-phone.png`, fullPage: true });
    assert.equal(await page.locator('.analytics-baseline time').getAttribute('datetime'), baseline);
    await resetButton.click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('heading', { name: 'Reset all statistics?' }).waitFor();
    assert.equal(writes, 0);
    assert.ok((await dialog.innerText()).includes('This will NOT delete users, videos, photos, files, messages, shares, or any uploaded content.'));
    await page.mouse.click(2, 2); await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible());
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(writes, 0); assert.ok(await top.getByText('Retained video', { exact: true }).isVisible());
    pass(width + 'px: admin action, baseline, protected confirmation and unchanged Cancel');

    fail = true; const readsBeforeFailure = reads;
    await resetButton.click(); await dialog.getByRole('button', { name: 'Reset All', exact: true }).click();
    await dialog.getByRole('alert').getByText('Statistics could not be reset. Please try again.', { exact: true }).waitFor();
    assert.equal(writes, 1); assert.equal(reads, readsBeforeFailure);
    assert.equal(await page.locator('.analytics-baseline time').getAttribute('datetime'), '2026-10-14T12:00:00+00:00');
    assert.ok(await top.getByText('Retained video', { exact: true }).isVisible());
    pass(width + 'px: failure stays in confirmation and preserves reports/timestamp');

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    holdOverview = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    for (let attempt = 0; attempt < 100 && !releaseOverview; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(releaseOverview, 'pre-reset request is in flight');
    await resetButton.click();
    fail = false;
    await dialog.getByRole('button', { name: 'Reset All', exact: true }).evaluate(button => { button.click(); button.click(); });
    await dialog.getByRole('button', { name: 'Resetting…' }).waitFor();
    assert.ok(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled());
    await page.getByRole('status').getByText('All statistics have been reset. New views and activity will count from now.', { exact: true }).waitFor();
    assert.equal(writes, 2); assert.equal(await dialog.count(), 0);
    await top.getByText('No data available.', { exact: true }).waitFor();
    releaseOverview();
    await page.waitForTimeout(100);
    assert.equal(await top.getByText('Retained video', { exact: true }).count(), 0);
    assert.equal(await page.locator('.analytics-baseline time').getAttribute('datetime'), baseline);
    await page.locator('.analytics-nav').getByRole('button', { name: 'Activity', exact: true }).click();
    await page.getByText('0 records · Page 1 of 1', { exact: true }).waitFor();
    assert.equal(navigations, 1);
    pass(width + 'px: guarded POST, reset/refresh, stale-response rejection, activity empty and no reload');

    // The regular refresh sees subsequent events without changing the baseline.
    count = 1; activity = 1;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('1 records · Page 1 of 1', { exact: true }).waitFor();
    await page.locator('.analytics-nav').getByRole('button', { name: 'Overview', exact: true }).click();
    await top.getByText('Retained video', { exact: true }).waitFor();
    assert.equal(await page.locator('.analytics-baseline time').getAttribute('datetime'), baseline);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    pass(width + 'px: new activity/rankings, responsive layout and no runtime errors');

    await page.goto(base + '/tests/admin-statistics-reset.html?regular');
    await page.getByRole('heading', { name: 'Admin access required' }).waitFor();
    assert.equal(await resetButton.count(), 0); assert.equal(writes, 2);
    pass(width + 'px: regular user cannot see the reset action');
    await context.close();
  }
  console.log(checks + ' admin statistics browser checks passed');
} finally { await browser.close(); }
