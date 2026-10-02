import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5204';
const owner = '11111111-1111-4111-8111-111111111111', folderId = '22222222-2222-4222-8222-222222222222';
const names = ['sample.pdf', 'sample.jpg', 'sample.jpeg', 'sample.png', 'sample.gif', 'sample.webp', 'sample.txt', 'sample.json', 'sample.xml', 'sample.csv', 'sample.docx', 'sample.xlsx', 'sample.pptx', 'corrupt.docx', 'queued.docx', 'sample.bin'];
const fixture = '.runtime/preview-fixtures/';
const pdf = await fs.readFile(fixture + 'sample.pdf'), image = await fs.readFile(fixture + 'sample.png');
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
try {
  for (const [label, width, height, touch] of [['PC', 1440, 900, false], ['Tablet', 768, 1024, true], ['Mobile', 375, 812, true], ['Mobile landscape', 844, 390, true]].filter(profile => !process.env.PREVIEW_PROFILE || profile[0] === process.env.PREVIEW_PROFILE)) {
    for (const guest of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      const page = await context.newPage(), errors = [], previewRequests = [], consoleErrors = [];
      const polls = new Map();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
      const entries = names.map((name, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`, name,
        path: guest ? `public/${folderId}/33333333-3333-4333-8333-${String(index).padStart(12, '0')}` : `${owner}/Documents/${name}`,
        isFolder: false, size: 1000, mimeType: 'application/octet-stream', updatedAt: new Date().toISOString(), favorite: false, trashedAt: null,
        location: 'Public files / Documents' }));
      await page.route('https://preview-test.supabase.co/**', async route => {
        const request = route.request(), url = new URL(request.url()), operation = url.pathname.split('/').pop();
        const body = request.method() === 'POST' ? request.postDataJSON() : {};
        if (operation === 'list_public_user_files') return route.fulfill({ json: body.p_folder ? entries : [{ id: folderId, name: 'Documents', path: 'public/' + folderId, isFolder: true, size: 0, mimeType: '', favorite: false, trashedAt: null, updatedAt: new Date().toISOString() }] });
        if (operation === 'user_file_metadata') return route.fulfill({ json: entries.map(e => ({ object_path: e.path, is_folder: false, file_size: e.size, mime_type: e.mimeType, is_favorite: false, trashed_at: null, updated_at: e.updatedAt, created_at: e.updatedAt })) });
        if (url.pathname.includes('/storage/v1/object/list/user-files')) return route.fulfill({ json: body.prefix === owner ? [{ name: 'Documents', id: null }] : entries.map(e => ({ name: e.name, id: e.id, metadata: { size: e.size, mimetype: e.mimeType } })) });
        if (operation !== 'file-preview') return route.fulfill({ json: [] });
        const entry = entries.find(e => url.searchParams.get('id') === e.id || url.searchParams.get('path') === e.path);
        assert.ok(entry); assert.equal(url.searchParams.has('id'), guest); assert.equal(url.searchParams.has('path'), !guest);
        previewRequests.push(entry.name);
        const extension = entry.name.split('.').pop(), count = (polls.get(entry.name) || 0) + 1; polls.set(entry.name, count);
        if (entry.name === 'corrupt.docx') return route.fulfill({ json: { status: 'failed', message: 'This document is corrupted. You can still download the original file.' } });
        if (entry.name === 'queued.docx' || (extension === 'docx' && count === 1)) return route.fulfill({ status: 202, json: { status: 'generating', queued: true } });
        const kind = ['docx', 'xlsx', 'pptx', 'pdf'].includes(extension) ? 'pdf' : ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension) ? 'image' : extension === 'csv' ? 'csv' : 'text';
        if (!url.searchParams.has('content')) return route.fulfill({ json: { status: 'available', kind } });
        const data = kind === 'pdf' ? pdf : kind === 'image' ? image : await fs.readFile(fixture + entry.name);
        return route.fulfill({ contentType: kind === 'pdf' ? 'application/pdf' : kind === 'image' ? 'image/png' : 'text/plain', body: data });
      });
      await page.goto(base + '/tests/file-previews.html' + (guest ? '?guest' : '') + (guest ? '#/public-files' : '#/files'));
      await page.getByText('Documents', { exact: true }).click();
      await page.getByText('sample.pdf', { exact: true }).waitFor();
      const folderUrl = page.url();
      const dialog = page.getByRole('dialog', { name: 'File preview' });
      async function menu(name) {
        console.log(`CHECK ${label} ${guest ? 'public' : 'private'} ${name}`);
        const trigger = page.getByRole('button', { name: 'Actions for ' + name, exact: true });
        await trigger.scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
        await trigger.click();
      }
      async function open(name) {
        await menu(name);
        await page.locator('.fm-menu').getByRole('button', { name: 'Preview', exact: true }).click();
        await dialog.waitFor();
      }
      async function close() {
        await dialog.getByRole('button', { name: 'Close preview' }).click();
        await dialog.waitFor({ state: 'detached' }); assert.equal(page.url(), folderUrl);
        assert.equal(await page.locator('[inert]').count(), 0); assert.equal(await page.locator('body').evaluate(e => e.style.overflow), '');
      }
      for (const name of names.slice(0, 13)) {
        await open(name);
        if (name.endsWith('.docx')) await dialog.getByText('Generating preview…', { exact: true }).waitFor();
        if (name.endsWith('.pdf') || /\.(docx|xlsx|pptx)$/.test(name)) {
          try { await dialog.locator('.page[data-loaded="true"] canvas').first().waitFor(); }
          catch (error) { console.log({ errors, consoleErrors, body: await page.locator('body').innerText() }); await page.screenshot({ path: '.runtime/pdf-preview-failure.png' }); throw error; }
          assert.ok(await dialog.locator('canvas').first().evaluate(e => e.width > 0 && e.height > 0));
          await dialog.getByText('Rendering PDF…', { exact: true }).waitFor({ state: 'hidden' });
          assert.ok(await dialog.locator('canvas').first().evaluate(canvas => {
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < data.length; i += 4) if (data[i + 3] && Math.min(data[i], data[i + 1], data[i + 2]) < 230) return true;
            return false;
          }), 'PDF page contains painted document content');
          if (name.endsWith('.pdf')) {
            await dialog.getByRole('button', { name: 'Next PDF page' }).click();
            await dialog.getByText('Page 2 / 2', { exact: true }).waitFor();
            await dialog.getByRole('button', { name: 'Previous PDF page' }).click();
            await dialog.getByRole('button', { name: 'Zoom in PDF' }).click();
            await dialog.getByRole('button', { name: 'Fit PDF to width' }).click();
          }
        }
        else if (/\.(jpg|jpeg|png|gif|webp)$/.test(name)) { await dialog.locator('img').waitFor(); assert.ok(await dialog.locator('img').evaluate(e => e.complete && e.naturalWidth > 0)); }
        else if (name.endsWith('.csv')) { await dialog.locator('table').waitFor(); assert.equal(await dialog.locator('td').filter({ hasText: 'Quoted, comma' }).count(), 1); }
        else { await dialog.locator('pre').waitFor(); assert.ok((await dialog.locator('pre').innerText()).length); }
        assert.ok(await dialog.evaluate(e => { const r = e.querySelector('section').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await close();
      }
      pass(`${label} ${guest ? 'public' : 'private'}: all 13 formats render; folder retained; no page overflow`);
      await open('sample.txt');
      assert.equal(await page.locator('[inert]').count() > 0, true);
      await page.mouse.click(1, 1); await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible());
      await dialog.getByRole('button', { name: 'Close preview' }).focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')), true);
      assert.equal((await dialog.locator('pre').innerText()).replaceAll('\r\n', '\n'), 'Safe text preview\n<script>alert(1)</script>');
      await close();
      pass(`${label}: overlay/Escape protected, focus trapped, HTML displayed as text`);
      await open('corrupt.docx'); await dialog.getByText('Preview could not be generated', { exact: true }).waitFor();
      assert.ok(await dialog.getByRole('button', { name: 'Download original file', exact: true }).last().isVisible()); await close();
      const beforeUnsupported = previewRequests.length;
      await menu('sample.bin');
      assert.equal(await page.locator('.fm-menu').getByRole('button', { name: 'Preview', exact: true }).count(), 0);
      await page.locator('.fm-menu').getByRole('button', { name: 'Open', exact: true }).click();
      await dialog.getByText('Preview is not available for this file type', { exact: true }).waitFor();
      assert.equal(previewRequests.length, beforeUnsupported); await close();
      pass(`${label}: failed and unsupported files retain Download; unsupported files not fetched`);
      await open('queued.docx'); await dialog.getByText('Generating preview…', { exact: true }).waitFor(); await close();
      const before = previewRequests.filter(n => n === 'queued.docx').length; await page.waitForTimeout(2200);
      assert.equal(previewRequests.filter(n => n === 'queued.docx').length, before);
      pass(`${label}: closing a queued preview cancels polling`);
      assert.deepEqual(errors, []); await context.close();
    }
  }
  console.log(`PASS ${checks} browser groups`);
} finally { await browser.close(); }
