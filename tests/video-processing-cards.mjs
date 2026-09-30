import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5199';
try{
  for(const width of [1440,768,375]){
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<1024});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let deletes=0;
    let jobs=Array.from({length:6},(_,index)=>({
      id:`22222222-2222-4222-8222-${String(index).padStart(12,'0')}`,
      file_name:index%2?'Фильм1':'A long failed upload name AVI MOV WMV MKV MP4',
      status:index===4?'queued':index===5?'cancelled':'error',visibility:'private',
      error:'Conversion failed because of invalid audio timestamps. Retry Processing to use the repaired converter.',
    }));
    await page.route('**/rest/v1/media_upload_jobs?*',route=>{
      const url=new URL(route.request().url());const statuses=url.searchParams.get('status');
      return route.fulfill({json:jobs.filter(job=>statuses?.includes(job.status))});
    });
    await page.route('**/functions/v1/delete-video',async route=>{
      deletes++;const {id}=route.request().postDataJSON();
      await new Promise(resolve=>setTimeout(resolve,100));
      jobs=jobs.filter(job=>job.id!==id);await route.fulfill({json:{deleted:true}});
    });
    await page.goto(base+'/tests/video-processing.html');
    await page.locator('article[data-upload-id]').first().waitFor();
    assert.equal(await page.locator('article[data-upload-id]').count(),6);
    const cards=await page.locator('article[data-upload-id]').evaluateAll(nodes=>nodes.map(card=>{
      const box=card.getBoundingClientRect(),thumbnail=card.querySelector('.mg-thumbnail').getBoundingClientRect();
      const actions=card.querySelector('.mg-actions').getBoundingClientRect();
      return {height:thumbnail.height,width:thumbnail.width,actionsBottom:actions.bottom,
        bottom:box.bottom,scrollTop:card.scrollTop};
    }));
    for(const card of cards){
      assert.ok(card.actionsBottom<=card.bottom,'actions must fit inside the card before automation scrolls');
      assert.ok(Math.abs(card.height/card.width-9/16)<.01,'placeholder keeps thumbnail aspect ratio');
      assert.equal(card.scrollTop,0,'card must not depend on hidden internal scrolling');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
    const card=page.locator('article[data-upload-id]').first();
    // Scroll the page as a person would. Do not scrollIntoView on the hidden
    // button: automation can scroll overflow:hidden and conceal this regression.
    await card.evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+scrollY-20));
    const hit=await card.locator('.mg-delete').evaluate(button=>{
      const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,
        visible:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
    });
    assert.ok(hit.visible,'Delete must be visible and receive a normal pointer/touch click');
    await page.mouse.click(hit.x,hit.y);const dialog=page.getByRole('alertdialog');await dialog.waitFor();
    assert.equal(deletes,0,'opening confirmation must not delete');
    await page.mouse.click(2,2);await page.keyboard.press('Escape');assert.ok(await dialog.isVisible());
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(deletes,0);
    await page.mouse.click(hit.x,hit.y);await dialog.getByRole('button',{name:'Delete',exact:true}).click();
    await dialog.waitFor({state:'detached'});assert.equal(deletes,1);
    assert.equal(await page.locator('article[data-upload-id]').count(),5);
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px: Failed/Processing/Deletion pending controls visible, clickable and confirmed`);
    await page.close();
  }
}finally{await browser.close()}
