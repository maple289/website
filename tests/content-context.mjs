// All network traffic is mocked; no real accounts, records or payloads change.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5217';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const owner = '11111111-1111-4111-8111-111111111111';
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500 });
    const page = await context.newPage();
    const now = new Date().toISOString();
    const objects = new Map(['note.txt','Src/.folder','Src/a.txt','Src/Sub/.folder','Src/Sub/b.txt','Dest/.folder','Archive/.folder','Archive/note.txt'].map(path => [`${owner}/${path}`, { id: path, size: 7, mimetype: 'text/plain' }]));
    const trashed = new Set();
    let activeLink = null, revoked = 0, sharePosts = 0, failOnce = true;
    const copies = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const metadata = () => [...objects].map(([path, object]) => ({ owner_id: owner, object_path: path.replace(/\/(\.folder|\.keep)$/, ''), is_folder: /\/(\.folder|\.keep)$/.test(path), is_favorite: false, file_size: object.size, mime_type: object.mimetype, trashed_at: trashed.has(path) ? now : null, created_at: now, updated_at: now }));
    await page.route('https://upload-test.supabase.co/**', async route => {
      const req = route.request(), url = new URL(req.url()), body = req.postDataJSON?.() ?? {};
      const rpc = url.pathname.split('/rpc/')[1];
      if (rpc === 'file_manager_metadata') return route.fulfill({ json: metadata().filter(row => row.object_path.split('/').slice(0, -1).join('/') === `${owner}${body.p_folder ? '/' + body.p_folder : ''}`) });
      if (rpc === 'file_manager_storage_bytes') return route.fulfill({ json: 14 });
      if (rpc === 'valid_file_clipboard') return route.fulfill({ json: true });
      if (rpc === 'get_temporary_share') return route.fulfill({ json: activeLink });
      if (rpc === 'revoke_temporary_share') { revoked++; activeLink = null; return route.fulfill({ body: '' }); }
      if (url.pathname.endsWith('/functions/v1/temporary-share')) { sharePosts++; activeLink = { id: '55555555-5555-4555-8555-555555555555', expires_at: new Date(Date.now() + 86400000).toISOString() }; return route.fulfill({ json: { ...activeLink, token: 'a'.repeat(64) } }); }
      if (rpc === 'plan_file_operation') {
        const keys = [...objects.keys()];
        const conflict = keys.some(path => path === body.p_destination || path.startsWith(body.p_destination + '/'));
        return route.fulfill({ json: conflict ? { conflict: true } : { conflict: false, objects: keys.filter(path => path === body.p_source || path.startsWith(body.p_source + '/')), metadata: metadata().filter(row => row.object_path === body.p_source || row.object_path.startsWith(body.p_source + '/')) } });
      }
      if (url.pathname.endsWith('/object/copy') || url.pathname.endsWith('/object/move')) {
        const copy = url.pathname.endsWith('/copy');
        if (copy) copies.push(body.destinationKey);
        if (copy && failOnce && body.destinationKey.endsWith('/Src/Sub/b.txt')) { failOnce = false; return route.fulfill({ status: 503, json: { message: 'Fixture transfer failure' } }); }
        if (objects.has(body.destinationKey)) return route.fulfill({ status: 409, json: { message: 'Destination exists' } });
        objects.set(body.destinationKey, objects.get(body.sourceKey));
        if (!copy) objects.delete(body.sourceKey);
        return route.fulfill({ json: { Key: body.destinationKey, message: 'Success' } });
      }
      if (url.pathname.endsWith('/object/list/user-files')) {
        const prefix = body.prefix + '/', names = new Map();
        for (const [path, object] of objects) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length), name = rest.split('/')[0];
          names.set(name, { id: rest.includes('/') ? null : object.id, name, metadata: rest.includes('/') ? null : object, created_at: now, updated_at: now });
        }
        return route.fulfill({ json: [...names.values()] });
      }
      if (url.pathname.includes('/rest/v1/user_file_metadata')) {
        if (req.method() === 'PATCH' && body.trashed_at) for (const path of objects.keys()) { if (url.searchParams.get('object_path')?.includes(path)) trashed.add(path); }
        const path = url.searchParams.get('object_path')?.replace(/^eq\./, '');
        const rows = metadata().filter(row => !path || row.object_path === path);
        return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? {} : rows });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(base + '/tests/content-context.html');
    await page.getByRole('button', { name: 'Actions for note.txt', exact: true }).waitFor();
    const photoCard = page.locator('.mg-card').first();
    const height = (await photoCard.boundingBox()).height;
    await page.getByRole('button', { name: 'Actions for Owned photo.jpg' }).click();
    const menu = page.getByRole('menu');
    assert.equal((await photoCard.boundingBox()).height, height);
    assert.ok(await menu.getByRole('menuitem', { name: 'Create 24-hour share link' }).isVisible());
    assert.equal(await menu.getByRole('menuitem', { name: 'Move', exact: true }).count(), 0);
    await page.screenshot({ path: `.runtime/context-menu-${width}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Actions for Other photo.jpg' }).click();
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Preview', 'Download']);
    await page.keyboard.press('Escape');
    pass(`${width}px: media permissions, Files-only operations, overlay preserves card height`);
    await page.getByRole('button', { name: 'Actions for Owned photo.jpg' }).click();
    await menu.getByRole('menuitem', { name: 'Create 24-hour share link' }).click();
    const share = page.getByRole('dialog', { name: 'Temporary Share Link', exact: true });
    await share.getByRole('button', { name: 'Create 24-hour share link' }).click();
    assert.match(await share.getByLabel('Temporary share URL').inputValue(), /\/share\/a{64}$/);
    assert.equal(sharePosts, 1);
    await share.getByRole('button', { name: 'Create new link', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(sharePosts, 1);
    await page.keyboard.press('Escape'); assert.ok(await share.isVisible());
    await share.getByRole('button', { name: 'Revoke', exact: true }).click();
    assert.equal(revoked, 0);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(revoked, 0);
    await share.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke', exact: true }).click();
    assert.equal(revoked, 1);
    await share.getByRole('button', { name: 'Close', exact: true }).click();
    pass(`${width}px: secure URL displayed, revoke confirmed, task dialog ignores Escape`);
    await page.getByRole('button', { name: 'Actions for note.txt', exact: true }).click();
    const panel = await menu.boundingBox(); assert.ok(panel.y >= 0 && panel.y + panel.height <= 900);
    assert.equal(await menu.getByRole('menuitem', { name: 'Paste here' }).isEnabled(), false);
    await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    assert.equal(await menu.count(), 0); assert.ok(objects.has(owner + '/note.txt'));
    await page.getByRole('button', { name: 'Paste', exact: true }).click();
    const conflict = page.getByRole('dialog', { name: 'Name conflict', exact: true });
    await conflict.getByRole('button', { name: 'Keep both', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for note (copy).txt', exact: true }).waitFor();
    assert.ok(objects.has(owner + '/note.txt')); assert.ok(objects.has(owner + '/note (copy).txt'));
    pass(`${width}px: Copy retains source, Paste uses clipboard, Keep both prevents overwrite`);
    await page.getByRole('button', { name: 'Actions for Src', exact: true }).click();
    await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await page.locator('.fm-card').filter({ has: page.getByText('Dest', { exact: true }) }).click();
    await page.getByRole('button', { name: 'Paste', exact: true }).click();
    const action = page.getByRole('dialog', { name: 'File or folder action', exact: true });
    await action.getByRole('alert').waitFor();
    assert.ok((await action.getByRole('alert').innerText()).includes('Fixture transfer failure'));
    await action.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for Src', exact: true }).waitFor();
    assert.ok(objects.has(owner + '/Dest/Src/Sub/b.txt')); assert.ok(objects.has(owner + '/Src/Sub/b.txt'));
    assert.equal(copies.filter(path => path === owner + '/Dest/Src/a.txt').length, 1);
    pass(`${width}px: folder tree copied, original retained, retry skips completed steps`);
    await page.getByRole('button', { name: 'Actions for Src', exact: true }).click();
    await menu.getByRole('menuitem', { name: 'Move', exact: true }).click();
    await action.getByRole('button', { name: 'Parent folder', exact: true }).click();
    await action.getByRole('button', { name: '📁 Archive', exact: true }).click();
    await action.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText('This folder is empty', { exact: true }).waitFor();
    assert.ok(![...objects.keys()].some(path => path.startsWith(owner + '/Dest/Src/')));
    assert.ok(objects.has(owner + '/Archive/Src/Sub/b.txt'));
    assert.ok(objects.has(owner + '/Src/Sub/b.txt'));
    pass(`${width}px: Move picker relocates full tree and removes the old location`);
    await page.getByRole('button', { name: 'File Storage', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for note.txt', exact: true }).click();
    await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await page.locator('.fm-card').filter({ has: page.getByText('Archive', { exact: true }) }).click();
    const before = [...objects.keys()].sort();
    await page.getByRole('button', { name: 'Paste', exact: true }).click();
    await conflict.getByRole('button', { name: 'Replace', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual([...objects.keys()].sort(), before);
    await action.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Replace', exact: true }).click();
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
    await action.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Actions for note.txt', exact: true }).waitFor();
    assert.ok(objects.has(owner + '/Archive/note.txt'));
    assert.ok([...objects.keys()].some(path => path.startsWith(owner + '/Archive/note.txt (replaced ')));
    assert.equal(trashed.size, 1);
    assert.ok(objects.has(owner + '/note.txt'));
    pass(`${width}px: replacement Cancel leaves data unchanged; confirmed Replace preserves prior item in Trash`);
    await page.getByRole('button', { name: 'Switch user', exact: true }).click();
    await page.getByRole('button', { name: 'Paste', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Paste', exact: true }).isEnabled(), false);
    assert.equal(await page.getByText(/Copied: /).count(), 0);
    assert.deepEqual(errors, []);
    pass(`${width}px: clipboard does not cross users; no runtime errors`);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`${checks} context-menu browser checks passed`);
