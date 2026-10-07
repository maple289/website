import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge' });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5217';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
try {
  const page = await browser.newPage({ viewport:{width:390,height:844} });
  let expired = false;
  await page.route('https://upload-test.supabase.co/**', route => {
    const url = new URL(route.request().url());
    assert.ok(url.pathname.endsWith('/functions/v1/temporary-share'), 'Visitor page must not query normal app endpoints');
    if (expired) return route.fulfill({status:410,json:{error:'This share link has expired.'}});
    return route.fulfill({json:url.searchParams.has('child') ? {type:'file',name:'Only this file.txt',mime:'text/plain'} : {type:'folder',name:'Only this folder',entries:[{name:'Only this file.txt',relative:'Only this file.txt',isFolder:false}],hasMore:false}});
  });
  await page.goto(base+'/tests/temporary-share.html');
  await page.getByRole('button',{name:'Only this file.txt',exact:true}).click();
  await page.getByRole('link',{name:'Download',exact:true}).waitFor();
  assert.equal(await page.getByRole('menu').count(),0);
  assert.equal(await page.locator('header,nav,aside,[aria-label^="Actions for"]').count(),0);
  assert.equal(await page.getByRole('button',{name:/edit|delete|share|profile|settings|admin/i}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  expired=true;
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.getByRole('alert').innerText(),'This share link has expired.');
  console.log('PASS standalone mobile visitor page: item-only endpoints, no owner/app controls, correct expired message');
} finally { await browser.close(); }
