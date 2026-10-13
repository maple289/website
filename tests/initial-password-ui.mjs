// Real auth provider/forms with isolated endpoints; no accounts or mail created.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
const base=process.env.TEST_BASE_URL;
const user={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email:'fixture@example.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const jwt=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:Math.floor(Date.now()/1000)+3600},'fixture-signature'].map(value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url')).join('.');
try {
 for(const [name,width,height] of [['Desktop',1440,900],['Tablet',768,1024],['Portrait',390,844],['Landscape',844,390]]) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1024});
  const page=await context.newPage();const actions=[],errors=[];let expired=true;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://upload-test.supabase.co/**',async route=>{
   if(route.request().url().includes('/account-login')) {
    const body=route.request().postDataJSON();actions.push(body);
    if(body.action==='request-temporary-password')return route.fulfill({json:{success:true}});
    if(body.action==='set-password') {
     if(expired)return route.fulfill({status:401,json:{error:'Password setup has expired. Sign in again.'}});
     await new Promise(resolve=>setTimeout(resolve,100));return route.fulfill({json:{success:true}});
    }
    if(body.password==='AbC_1234xY-z')return route.fulfill({json:{requires_password_setup:true,setup_token:'a'.repeat(64),expires_in:900}});
    return route.fulfill({json:{session:{access_token:jwt,refresh_token:'fixture-refresh'}}});
   }
   if(route.request().url().includes('/auth/v1/user'))return route.fulfill({json:user});
   return route.fulfill({json:[]});
  });
  await page.goto(base+'/tests/initial-password-ui.html');
  const dialog=page.getByRole('dialog',{name:'Sign in or register'});
  await dialog.waitFor();await dialog.getByLabel('Email',{exact:true}).fill(user.email);
  await dialog.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal(actions.length,0,'blank password cannot start sign-in');
  await dialog.getByRole('button',{name:'Request temporary password',exact:true}).click();
  await dialog.getByText('If your approved account still needs password setup,',{exact:false}).waitFor();
  assert.equal(actions[0].action,'request-temporary-password');
  await dialog.getByLabel('Password',{exact:true}).fill('AbC_1234xY-z');
  await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Create your password'}).waitFor();
  assert.equal(await page.getByLabel('Email verification code').count(),0);
  assert.equal(await page.getByText('Signed in successfully').count(),0);
  assert.equal(await page.evaluate(()=>[...Object.values(sessionStorage),...Object.values(localStorage)].some(value=>value.includes('a'.repeat(64)))),false);
  await page.reload();
  await dialog.waitFor();
  await dialog.getByLabel('Email',{exact:true}).fill(user.email);
  await dialog.getByLabel('Password',{exact:true}).fill('AbC_1234xY-z');
  await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Create your password'}).waitFor();
  await page.getByLabel('New Password',{exact:true}).fill('permanent fixture password');
  await page.getByLabel('Confirm New Password',{exact:true}).fill('permanent fixture password');
  await page.getByRole('button',{name:'Return to sign in'}).click();
  await page.getByRole('button',{name:'Keep Editing',exact:true}).click();
  assert.equal(await page.getByLabel('New Password',{exact:true}).inputValue(),'permanent fixture password');
  await page.getByRole('button',{name:'Save password and continue'}).click();
  await page.getByRole('alert').getByText('Password setup has expired.',{exact:false}).waitFor();
  assert.equal(await page.getByLabel('New Password',{exact:true}).inputValue(),'permanent fixture password');
  expired=false;
  await page.getByRole('button',{name:'Save password and continue'}).evaluate(button=>{button.click();button.click();});
  await page.getByText('Signed in successfully').waitFor();
  assert.equal(actions.filter(action=>action.action==='set-password').length,2,'only one request per explicit submission');
  assert.equal(actions.find(action=>action.action==='set-password').setup_token,'a'.repeat(64));
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log(`PASS ${name}: normal password field, explicit resend, protected permanent-password draft, expired setup error, duplicate-submit guard, memory-only capability and full login`);
  await context.close();
 }
}finally{await browser.close();}
