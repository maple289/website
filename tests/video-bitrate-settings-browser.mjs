import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5211';
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
let checks=0;const pass=label=>{checks++;console.log('PASS '+label)};
try {
 for(const width of [1440,768,390]) {
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024});
  const page=await context.newPage(),errors=[];let current=3,writes=0,fail=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://upload-test.supabase.co/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/rpc/is_admin'))return route.fulfill({json:!url.searchParams.has('regular')&&!page.url().includes('?regular')});
   if(url.pathname.endsWith('/functions/v1/storage-settings')) {
    if(request.method()==='PUT') {
     writes++;const body=request.postDataJSON();assert.deepEqual(Object.keys(body),['target_video_bitrate_mbps']);
     await new Promise(resolve=>setTimeout(resolve,150));
     if(fail)return route.fulfill({status:500,json:{error:'Fixture save failed'}});
     current=body.target_video_bitrate_mbps;
    }
    return route.fulfill({json:{videos_base_path:'videos',images_base_path:'images',file_server_url:'',target_video_bitrate_mbps:current,updated_at:'2026-10-04T00:00:00Z'}});
   }
   return route.fulfill({json:[]});
  });
  const settings=async()=>{
   await page.getByRole('heading',{name:'User Accounts',exact:true}).waitFor();
   if(width<1024)await page.getByRole('button',{name:'Open admin navigation'}).click();
   await page.getByRole('button',{name:'Settings',exact:true}).click();
   await page.getByLabel('Target Video Bitrate',{exact:true}).waitFor();
  };
  await page.goto(base+'/tests/video-bitrate-settings.html');await settings();
  const input=page.getByLabel('Target Video Bitrate',{exact:true}),save=page.getByRole('button',{name:'Save Video Processing'});
  assert.equal(await input.inputValue(),'3.0');assert.ok(await save.isDisabled());
  await input.fill('0.5');assert.ok(await save.isDisabled());assert.equal(writes,0);
  await input.fill('4.5');await input.evaluate(el=>{const form=el.form;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await page.getByText('Video processing settings saved.',{exact:true}).waitFor();assert.equal(writes,1);assert.ok(await save.isDisabled());
  pass(width+'px: valid save, numeric validation and duplicate-submit guard');
  await page.reload();await settings();assert.equal(await input.inputValue(),'4.5');
  fail=true;await input.fill('3');await save.click();await page.getByText('Fixture save failed',{exact:true}).waitFor();
  assert.equal(await input.inputValue(),'3');assert.ok((await page.getByText('Current target:',{exact:false}).innerText()).includes('4.5'));
  pass(width+'px: persisted value reloads and failed save preserves draft/current value');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const dialog=page.getByRole('alertdialog');await dialog.waitFor();await page.mouse.click(2,2);await page.keyboard.press('Escape');assert.ok(await dialog.isVisible());
  await dialog.getByRole('button',{name:'Keep Editing'}).click();assert.equal(await input.inputValue(),'3');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Discard',exact:true}).click();
  assert.equal(await input.inputValue(),'4.5');assert.equal(writes,2);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  pass(width+'px: protected discard dialog, touch layout and no overflow/runtime errors');
  await page.goto(base+'/tests/video-bitrate-settings.html?regular');await page.getByRole('heading',{name:'Admin access required'}).waitFor();assert.equal(await page.getByLabel('Target Video Bitrate',{exact:true}).count(),0);
  pass(width+'px: normal user does not see Admin setting');await context.close();
 }
 console.log(checks+' Admin settings browser checks passed');
}finally{await browser.close();}
