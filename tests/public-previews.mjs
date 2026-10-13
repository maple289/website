// Optional engine override allows the same fixture regression to run in Firefox.
import assert from 'node:assert/strict';
const engines=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine=process.env.BROWSER_ENGINE || 'chromium';
const browser=await engines[engine].launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5217';
try{
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:844},...(engine==='chromium'&&width===390?{hasTouch:true}:{})});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const img=async alt=>{
      await page.getByRole('img',{name:alt,exact:true}).waitFor();
      await page.waitForFunction(alt=>[...document.querySelectorAll('img')].some(i=>i.alt===alt&&i.complete&&i.naturalWidth>0),alt);
    };
    const click=async name=>page.getByRole('button',{name,exact:true}).click();
    await page.goto(base+'/tests/public-previews.html');await img('Public video');
    await page.reload();await img('Public video');
    await click('Simulate failed video image');await page.getByRole('img',{name:'Public video',exact:true}).waitFor({state:'detached'});
    await click('Fixture sign in');await img('Public video');
    await click('Fixture sign out');await img('Public video');
    for(let i=0;i<2;i++){await click('Fixture sign in');await img('Public video');await click('Fixture sign out');await img('Public video');}
    await click('photos');await img('Public photo');await page.reload();await img('Public photo');await click('Fixture sign in');await img('Public photo');
    await click('owned');await page.getByRole('heading',{name:'Owned photo',exact:true}).waitFor();
    await click('Fixture sign out');await page.getByText('Private content hidden',{exact:true}).waitFor();
    assert.equal(await page.getByRole('img',{name:'Owned photo',exact:true}).count(),0);
    await click('files');await img('public-image.png');
    await page.reload();await img('public-image.png');
    assert.ok(await page.locator('svg[aria-label="Word document"]').count());
    const before=await page.getByRole('img',{name:'public-image.png',exact:true}).getAttribute('src');
    await click('Fixture sign in');await img('public-image.png');await click('Fixture sign out');await img('public-image.png');
    assert.equal(await page.getByRole('img',{name:'public-image.png',exact:true}).getAttribute('src'),before);
    await page.getByText('public-document.docx',{exact:true}).dblclick();
    await page.getByText('Public generated preview',{exact:true}).waitFor();
    await click('Close preview');await click('videos');await img('Public video');
    await page.reload();await img('Public video');assert.deepEqual(errors,[]);
    console.log(`PASS ${engine} ${width}px: anonymous previews/refresh, failure recovery, repeated auth transitions, private hiding, file icons/image reuse and generated preview`);
    await page.close();
  }
}finally{await browser.close();}
