// Exercise link creation and the real App entrypoint under root and IIS /video/ hosting.
// All Supabase requests use fixture data; no production records are changed.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const token = 'a'.repeat(64);
try {
  for (const base of ['/', '/video/']) {
    const server = await createServer({
      configFile: false, root: process.cwd(), base, plugins: [react()], envPrefix: [],
      resolve: { alias: { '@': path.resolve('src') } },
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://upload-test.supabase.co'),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fixture-anon'),
      },
      server: { host: '127.0.0.1', port: 5218, strictPort: true },
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await server.listen();
      const origin = 'http://127.0.0.1:5218';
      const page = await context.newPage();
      const errors = [], unexpected = [];
      let visitor = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://upload-test.supabase.co/**', route => {
        const request = route.request(), url = new URL(request.url());
        const isShare = url.pathname.endsWith('/functions/v1/temporary-share');
        if (visitor && !isShare) unexpected.push(url.pathname);
        if (url.pathname.endsWith('/rpc/get_temporary_share')) return route.fulfill({ json: null });
        if (!isShare) return route.fulfill({ json: [] });
        if (request.method() === 'POST') return route.fulfill({ json: {
          id: '55555555-5555-4555-8555-555555555555', token,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        } });
        if (url.searchParams.get('token') !== token) return route.fulfill({ status: 404, json: { error: 'This share link is no longer available.' } });
        return route.fulfill({ json: { type: 'file', name: 'Only this shared file.txt', mime: 'text/plain' } });
      });
      await page.goto(`${origin}${base}tests/content-context.html`);
      await page.getByRole('button', { name: 'Actions for Owned photo.jpg' }).click();
      await page.getByRole('menuitem', { name: 'Create 24-hour share link' }).click();
      const dialog = page.getByRole('dialog', { name: 'Temporary Share Link', exact: true });
      await dialog.getByRole('button', { name: 'Create 24-hour share link' }).click();
      const link = dialog.getByLabel('Temporary share URL');
      await link.waitFor();
      assert.equal(await link.inputValue(), `${origin}${base}share/${token}`);

      visitor = true;
      await page.goto(await link.inputValue());
      await page.getByRole('heading', { name: 'Only this shared file.txt' }).waitFor();
      assert.match(await page.getByRole('link', { name: 'Download', exact: true }).getAttribute('href'), /token=a{64}&download=1$/);
      assert.equal(await page.locator('header,nav,aside,[aria-label^="Actions for"]').count(), 0);
      assert.equal(await page.getByRole('button', { name: /edit|delete|share|profile|settings|admin/i }).count(), 0);
      await page.goto(`${origin}${base}share/invalid`);
      assert.equal(await page.getByRole('alert').innerText(), 'This share link is no longer available.');
      assert.equal(await page.locator('header,nav,aside').count(), 0);
      assert.deepEqual(unexpected, []);
      assert.deepEqual(errors, []);
      console.log(`PASS ${base}: generated link opens the real isolated App route; malformed link remains isolated`);
    } finally {
      await context.close();
      await server.close();
    }
  }
} finally { await browser.close(); }
