// Client-only regression: intercept registration so no account or email is created.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5199/';
try {
  for(const width of [1440,768,390]) {
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<1024});
    let submissions=0;
    await page.route('**/functions/v1/notify-admin-registration',route=>{
      submissions++;
      return route.fulfill({json:{success:true}});
    });
    await page.goto(base+'#/login',{waitUntil:'domcontentloaded'});
    const dialog=page.getByRole('dialog',{name:'Sign in or register'});
    await dialog.waitFor();
    await dialog.getByRole('button',{name:'Create one',exact:true}).click();
    await dialog.locator('input[type=email]').fill('reviewed-request@example.invalid');
    await dialog.getByRole('button',{name:'Request account',exact:true}).click();
    await dialog.getByText('Your request has been received.',{exact:false}).waitFor();
    assert.ok((await dialog.innerText()).includes('previously reviewed requests do not create another request or email'));
    assert.ok(!(await dialog.innerText()).includes('Your registration request has been submitted'));
    assert.ok(await dialog.getByRole('button',{name:'Request received',exact:true}).isDisabled());
    assert.equal(submissions,1);
    await page.keyboard.press('Escape');
    assert.ok(await dialog.isVisible());
    assert.ok(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    console.log(`PASS ${width}px: accurate feedback, no repeat submission, protected dialog and explicit close`);
    await page.close();
  }
}finally{await browser.close();}
