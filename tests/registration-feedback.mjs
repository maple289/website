// Client-only regression: intercept registration so no account or email is created.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5199/';
try {
  for(const width of [1440,768,390]) {
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<1024});
    let submissions=0;
    const warnings = {
      'account@example.invalid': 'This email address already exists. Please enter another email address, or sign in to your existing account.',
      'pending@example.invalid': 'A registration request for this email is already awaiting administrator approval. Please wait for approval, or enter another email address.',
      'reviewed@example.invalid': 'A registration request for this email has already been reviewed. Please enter another email address, or contact an administrator about your previous request.',
    };
    await page.route('**/functions/v1/notify-admin-registration',route=>{
      submissions++;
      const error=warnings[route.request().postDataJSON().email];
      if(error)return route.fulfill({status:409,json:{error}});
      return route.fulfill({json:{success:true}});
    });
    await page.goto(base+'#/login',{waitUntil:'domcontentloaded'});
    const dialog=page.getByRole('dialog',{name:'Sign in or register'});
    await dialog.waitFor();
    await dialog.getByRole('button',{name:'Create one',exact:true}).click();
    for(const [email,error] of Object.entries(warnings)) {
      await dialog.locator('input[type=email]').fill(email);
      await dialog.getByRole('button',{name:'Request account',exact:true}).click();
      await dialog.getByRole('alert').getByText(error,{exact:true}).waitFor();
      assert.equal(await dialog.locator('input[type=email]').inputValue(),email);
      assert.ok(await dialog.locator('input[type=email]').isEnabled());
      assert.ok(await dialog.getByRole('button',{name:'Request account',exact:true}).isEnabled());
    }
    await dialog.locator('input[type=email]').fill('new-request@example.invalid');
    await dialog.getByRole('button',{name:'Request account',exact:true}).click();
    await dialog.getByText('Your registration request has been submitted for administrator approval.',{exact:false}).waitFor();
    assert.equal(await dialog.getByRole('alert').count(),0);
    assert.ok(await dialog.getByRole('button',{name:'Request submitted',exact:true}).isDisabled());
    assert.equal(submissions,4);
    await page.keyboard.press('Escape');
    assert.ok(await dialog.isVisible());
    assert.ok(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    console.log(`PASS ${width}px: existing/pending/reviewed warnings, editable email, successful retry, no repeat submission and protected dialog`);
    await page.close();
  }
}finally{await browser.close();}
