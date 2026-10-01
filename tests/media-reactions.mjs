// From the repository root, start `node tests/media-reactions-server.mjs`,
// then run this file. PLAYWRIGHT_MODULE can reference a bundled installation.
// REACTION_PROFILE optionally selects one profile from the matrix below.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5203';
const poster='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#b9d6ed"/><circle cx="492" cy="98" r="43" fill="#fff4ce"/><path d="M0 360L170 160L360 420L460 220L640 410V480H0" fill="#789b9b"/><path d="M0 410L245 280L500 450L640 348V480H0" fill="#476f72"/></svg>';
const profiles=[
  ['PC',1440,900,false],['Tablet portrait',768,1024,true],['Tablet landscape',1024,768,true],
  ['Phone portrait',375,812,true],['Phone portrait large',390,844,true],['Phone narrow',320,640,true],
  ['Phone landscape',844,390,true],['Phone landscape small',667,375,true],
];
let checks=0;
function pass(label){checks++;console.log('PASS '+label);}
async function until(check,message){
  for(let attempt=0;attempt<50;attempt++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40));}
  assert.fail(message);
}
async function swipe(page,locator,left,vertical=false){
  const r=await locator.boundingBox(),inset=Math.min(20,r.width*.15);
  const start=left?(vertical?r.y+r.height-inset:r.x+r.width-inset):(vertical?r.y+inset:r.x+inset);
  const end=left?(vertical?r.y+inset:r.x+inset):(vertical?r.y+r.height-inset:r.x+r.width-inset);
  const point=value=>vertical?{x:r.x+r.width/2,y:value,id:0}:{x:value,y:r.y+r.height/2,id:0};
  const cdp=await page.context().newCDPSession(page);
  try{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(start)]});
    for(let step=1;step<=6;step++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(start+(end-start)*step/6)]});
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }finally{await cdp.detach();}
}
try{
  for(const [label,width,height,touch] of profiles.filter(profile=>!process.env.REACTION_PROFILE||profile[0]===process.env.REACTION_PROFILE)){
    const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
    const page=await context.newPage(),errors=[],writes=[];
    let failNext=false,delayNext=false;
    page.on('pageerror',error=>errors.push(error.message));
    const entries=new Map();
    const entry=(type,id)=>{
      const key=type+':'+id;
      if(!entries.has(key))entries.set(key,{counts:{like:4,dislike:2,smile:3,lol:1,love:2,angry:1},own:type==='video'?'love':'like'});
      return entries.get(key);
    };
    await page.route('**/tests/reaction-poster.svg',route=>route.fulfill({contentType:'image/svg+xml',body:poster}));
    await page.route('https://reaction-test.supabase.co/**',async route=>{
      const request=route.request(),url=new URL(request.url()),operation=url.pathname.split('/').pop();
      const data=request.method()==='POST'?request.postDataJSON():{};
      if(operation==='get_media_reactions')return route.fulfill({json:data.p_ids.map(id=>{
        const value=entry(data.p_type,id);return {media_id:id,counts:value.counts,own_reaction:value.own};
      })});
      if(operation==='set_media_reaction'){
        writes.push(data);
        if(delayNext){delayNext=false;await new Promise(resolve=>setTimeout(resolve,180));}
        if(failNext){failNext=false;return route.fulfill({status:500,json:{message:'fixture failure'}});}
        const value=entry(data.p_type,data.p_id);
        if(value.own)value.counts[value.own]=Math.max(0,(value.counts[value.own]??0)-1);
        if(data.p_reaction)value.counts[data.p_reaction]=(value.counts[data.p_reaction]??0)+1;
        value.own=data.p_reaction;return route.fulfill({json:null});
      }
      if(operation==='get_media_reaction_users')return route.fulfill({json:[{user_id:'11111111-1111-4111-8111-111111111111',display_name:'Alex'},{user_id:'44444444-4444-4444-8444-444444444444',display_name:'river'}]});
      if(operation==='get_storage_base_path')return route.fulfill({json:''});
      if(operation==='serve-media')return route.fulfill({json:{url:base+'/tests/fixtures/media-valid.mp4'}});
      if(url.pathname.startsWith('/storage/v1/object/sign/')&&request.method()==='POST')return route.fulfill({json:{signedURL:'/object/sign/user-images/fixture/photo.svg?token=fixture'}});
      if(url.pathname.startsWith('/storage/'))return route.fulfill({contentType:'image/svg+xml',body:poster});
      return route.fulfill({json:null});
    });
    const act=async locator=>touch?locator.tap():locator.click();
    const selector=page.getByRole('group',{name:'Choose your reaction',exact:true});
    async function geometry(scope){
      const metrics=await scope.locator('.reaction-row').evaluate(row=>{
        const box=row.getBoundingClientRect(),buttons=[...row.querySelectorAll('.reaction-selector button')].map(button=>button.getBoundingClientRect());
        const summary=row.querySelector('.reaction-summary'),first=summary?.querySelector('button');
        return {height:box.height,buttons:buttons.map(r=>({x:r.x,y:r.y,width:r.width,height:r.height})),summaryWidth:summary?.getBoundingClientRect().width??0,
          firstCountWidth:first?.getBoundingClientRect().width??0};
      });
      assert.ok(metrics.height<=(touch?44.5:32.5),'reaction controls should occupy one row');
      assert.equal(metrics.buttons.length,2,'selected reaction stays next to trigger');
      assert.ok(Math.abs(metrics.buttons[0].y-metrics.buttons[1].y)<1,'selected reaction must share trigger baseline');
      if(touch)metrics.buttons.forEach(r=>{assert.ok(r.width>=43.5&&r.height>=43.5,'primary touch targets >=44px');});
      assert.ok(metrics.summaryWidth>=metrics.firstCountWidth-1,'at least one complete count must be readable on narrow cards');
    }
    async function open(scope){
      const before=await scope.locator('.reaction-row').evaluate(row=>row.getBoundingClientRect().height);
      await scope.locator('.reaction-add').scrollIntoViewIfNeeded();await act(scope.locator('.reaction-add'));await selector.waitFor();
      const boxes=await selector.locator('button').evaluateAll(buttons=>buttons.map(button=>{
        const r=button.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};
      }));
      assert.equal(boxes.length,6,'only the six reaction choices');
      assert.equal(await selector.locator('.reaction-remove,svg').count(),0,'no separate delete/remove action');
      boxes.forEach((box,index)=>{
        assert.ok(Math.abs(box.x-boxes[0].x)<1,'selector must use one column');
        if(index)assert.ok(box.y>boxes[index-1].y,'reactions ordered vertically');
        if(touch)assert.ok(box.w>=43.5&&box.h>=43.5,'menu touch targets >=44px');
      });
      const rect=await selector.boundingBox();
      assert.ok(rect.x>=0&&rect.x+rect.width<=width+1&&rect.y>=0&&rect.y+rect.height<=height+1,'selector stays within viewport');
      const trigger=await scope.locator('.reaction-add').boundingBox();
      assert.ok(rect.y+rect.height<=trigger.y+1,'selector always opens above trigger');
      assert.equal(Math.round(await scope.locator('.reaction-row').evaluate(row=>row.getBoundingClientRect().height)),Math.round(before),'opening menu must not resize card');
    }
    await page.goto(base+'/tests/media-reactions.html');
    const video=page.locator('article').filter({has:page.getByRole('button',{name:'Play Mountain weekend.mp4',exact:true})}),photo=page.getByTestId('photo-card');
    await until(async()=>await video.locator('.reaction-add').isEnabled()&&await photo.locator('.reaction-add').isEnabled(),'reaction data loads');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'no page horizontal overflow');
    await geometry(video);await geometry(photo);pass(label+': compact row, aligned selection and touch targets');
    for(const [kind,card] of [['video',video],['photo',photo]]){
      await open(card);
      if(kind==='photo'&&(width===375||width===1440))await page.screenshot({path:'.runtime/reactions-'+(touch?'phone':'desktop')+'.png',animations:'disabled'});
      if(label==='Tablet portrait'&&kind==='photo'){
        await page.setViewportSize({width:height,height:width});
        await until(async()=>{
          const box=await selector.boundingBox(),trigger=await card.locator('.reaction-add').boundingBox();
          return box&&box.x>=0&&box.y>=0&&box.x+box.width<=height&&box.y+box.height<=trigger.y+1;
        },'open menu repositions after rotation');
        await page.setViewportSize({width,height});
        await until(async()=>{
          const box=await selector.boundingBox(),trigger=await card.locator('.reaction-add').boundingBox();
          return box&&box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=trigger.y+1;
        },'open menu restores after rotation');pass('Tablet rotates with menu open');
      }
      if(!touch){
        await page.getByRole('heading',{name:'Compact reactions',exact:true}).hover();
        await selector.waitFor({state:'detached'});
        await card.locator('.reaction-add').hover();await selector.waitFor();
        await selector.getByRole('button',{name:'Smile',exact:true}).hover();
        assert.ok(await selector.isVisible(),'menu remains open across pointer gap');
      }
      await act(selector.getByRole('button',{name:'Smile',exact:true}));
      await selector.waitFor({state:'detached'});
      await card.getByRole('button',{name:'Your reaction: Smile. Click to remove',exact:true}).waitFor();
      assert.equal(await page.getByRole('dialog').count(),0,'reacting must not open viewer');
      pass(label+': '+kind+' vertical menu, '+(touch?'tap':'hover')+' selection and collapse');
      await until(async()=>await card.locator('.reaction-selected').isEnabled(),'selection finished saving');
      const before=writes.length;delayNext=true;
      await act(card.locator('.reaction-selected'));
      assert.equal(await card.locator('.reaction-selected').count(),0,'selected reaction toggles off immediately');
      assert.equal(await card.locator('.reaction-add').isDisabled(),true,'pending toggle guards repeat requests');
      assert.equal(await page.getByRole('alertdialog').count(),0,'no reaction removal confirmation');
      await until(async()=>await card.locator('.reaction-add').isEnabled(),'toggle finished saving');
      assert.equal(writes.length,before+1,'one toggle request');
      pass(label+': '+kind+' applied reaction toggles off without confirmation');
      await act(card.getByRole('button',{name:'Add reaction',exact:true}));await selector.waitFor();
      await act(selector.getByRole('button',{name:'Love',exact:true}));await selector.waitFor({state:'detached'});
      await until(async()=>await card.locator('.reaction-add').isEnabled(),'reaction saved');
      await open(card);await act(selector.getByRole('button',{name:'Remove Love reaction',exact:true}));await selector.waitFor({state:'detached'});
      assert.equal(await card.locator('.reaction-selected').count(),0);
      assert.equal(await page.getByRole('alertdialog').count(),0);
      await until(async()=>await card.locator('.reaction-add').isEnabled(),'menu toggle saved');
      await act(card.getByRole('button',{name:'Add reaction',exact:true}));await selector.waitFor();
      await act(selector.getByRole('button',{name:'Love',exact:true}));await selector.waitFor({state:'detached'});
      await until(async()=>await card.locator('.reaction-add').isEnabled(),'replacement saved');
      pass(label+': '+kind+' same menu reaction toggles off');
      const writesBeforeDetails=writes.length;
      await act(card.locator('.reaction-summary button').first());
      const details=page.getByRole('region',{name:'Like reactions',exact:true});await details.waitFor();await details.getByText('Alex',{exact:true}).waitFor();
      assert.equal(await details.getByText(/@/).count(),0,'details display names only');
      assert.equal(await details.locator('header button,svg,[aria-label*="Remove"],[aria-label*="Delete"]').count(),0,'details contain no close/delete/remove icons or actions');
      await act(details.getByText('Alex',{exact:true}));
      assert.equal(writes.length,writesBeforeDetails,'informational details never change a reaction');
      const detailsBox=await details.boundingBox();
      assert.ok(detailsBox.x>=0&&detailsBox.x+detailsBox.width<=width+1&&detailsBox.y>=0&&detailsBox.y+detailsBox.height<=height+1,'details stay within visible viewport');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'popover must not broaden mobile viewport');
      await act(page.getByRole('heading',{name:'Compact reactions',exact:true}));await details.waitFor({state:'detached'});
      pass(label+': '+kind+' informational details without close/delete icons, outside dismissal');
      if(touch){
        const summary=card.locator('.reaction-summary');
        // Outside dismissal may scroll the gallery to the heading. Native
        // touch gestures require the count strip to be visible again.
        await summary.scrollIntoViewIfNeeded();
        if(await summary.evaluate(node=>node.scrollWidth>node.clientWidth)){
          const before=await summary.evaluate(node=>node.scrollLeft);
          await swipe(page,summary,true);
          await until(async()=>await summary.evaluate(node=>node.scrollLeft)>before,'touch swipe scrolls counts');
          // A tap during native momentum scrolling stops the scroll instead of
          // clicking. Wait for that user gesture to finish before the next action.
          let previous=-1,stable=0;
          await until(async()=>{
            const current=await summary.evaluate(node=>node.scrollLeft);
            stable=Math.abs(current-previous)<.5?stable+1:0;previous=current;return stable>=4;
          },'touch scrolling settles');
          assert.equal(await page.getByRole('dialog').count(),0,'scrolling counts must not open viewer');
          pass(label+': '+kind+' counts can be scrolled by touch');
        }
      }
    }
    // Real viewers use the same store and portal inside their protected modal.
    await act(video.getByRole('button',{name:'Play Mountain weekend.mp4',exact:true}));
    let viewer=page.getByRole('dialog',{name:'Video player',exact:true});await viewer.waitFor();
    await until(async()=>await viewer.locator('video').evaluate(v=>v.readyState>=2).catch(()=>false),'video playback ready');
    // Loop the short fixture so reaching its end cannot look like an
    // interruption caused by reacting, especially during touch emulation.
    await viewer.locator('video').evaluate(async v=>{v.loop=true;v.muted=true;await v.play();});
    await until(async()=>await viewer.locator('video').evaluate(v=>!v.paused),'video is playing before reacting');
    await open(viewer);await act(selector.getByRole('button',{name:'LOL',exact:true}));await selector.waitFor({state:'detached'});
    assert.ok(await viewer.isVisible());assert.equal(await viewer.locator('video').evaluate(v=>v.paused),false,'reactions do not pause video');
    await act(viewer.getByRole('button',{name:'Close video player'}));
    await video.getByRole('button',{name:'Your reaction: LOL. Click to remove',exact:true}).waitFor();pass(label+': video playback and gallery/viewer synchronization');
    await act(photo.getByRole('button',{name:'Open Mountain landscape.jpg',exact:true}));
    viewer=page.getByRole('dialog',{name:'Photo viewer',exact:true});await viewer.waitFor();
    await open(viewer);await act(selector.getByRole('button',{name:'LOL',exact:true}));await selector.waitFor({state:'detached'});
    await viewer.getByText('1 of 2',{exact:true}).waitFor();
    await until(async()=>await viewer.locator('.reaction-add').isEnabled(),'photo reaction finished saving');
    await viewer.locator('.reaction-add').press('Space');await selector.waitFor();
    await viewer.getByText('1 of 2',{exact:true}).waitFor();await act(viewer.locator('.pv-info'));await selector.waitFor({state:'detached'});
    await act(viewer.getByRole('button',{name:'Next photo',exact:true}));await viewer.getByText('2 of 2',{exact:true}).waitFor();
    await act(viewer.getByRole('button',{name:'Previous photo',exact:true}));await viewer.getByText('1 of 2',{exact:true}).waitFor();
    if(touch){
      await swipe(page,viewer.locator('.pv-stage'),true);await viewer.getByText('2 of 2',{exact:true}).waitFor();
      await swipe(page,viewer.locator('.pv-stage'),false);await viewer.getByText('1 of 2',{exact:true}).waitFor();
      pass(label+': photo swipes remain available');
    }else{
      await viewer.locator('.pv-stage').click();await page.keyboard.press('ArrowRight');await viewer.getByText('2 of 2',{exact:true}).waitFor();
      await page.keyboard.press('ArrowLeft');await viewer.getByText('1 of 2',{exact:true}).waitFor();
      await page.keyboard.press('Space');await viewer.getByText('2 of 2',{exact:true}).waitFor();
      await page.keyboard.press('Alt+Space');await viewer.getByText('1 of 2',{exact:true}).waitFor();
      const stage=await viewer.locator('.pv-stage').boundingBox();await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);
      await page.mouse.wheel(0,120);await viewer.getByText('2 of 2',{exact:true}).waitFor();await new Promise(resolve=>setTimeout(resolve,500));
      await page.mouse.wheel(0,-120);await viewer.getByText('1 of 2',{exact:true}).waitFor();
      pass(label+': photo keyboard and mouse-wheel navigation remain available');
    }
    await act(viewer.getByRole('button',{name:'Close',exact:true}));
    await photo.getByRole('button',{name:'Your reaction: LOL. Click to remove',exact:true}).waitFor();pass(label+': photo navigation and gallery/viewer synchronization');
    // A rejected mutation rolls optimistic UI back; repeat taps remain guarded.
    failNext=true;delayNext=true;
    await act(video.locator('.reaction-add'));await selector.waitFor();await act(selector.getByRole('button',{name:'Angry',exact:true}));
    await video.getByRole('alert').waitFor();await video.getByRole('button',{name:'Your reaction: LOL. Click to remove',exact:true}).waitFor();
    pass(label+': failed save retains previous reaction and shows error');
    failNext=true;delayNext=true;await act(video.locator('.reaction-selected'));
    assert.equal(await video.locator('.reaction-selected').count(),0);
    await video.getByRole('alert').waitFor();await video.getByRole('button',{name:'Your reaction: LOL. Click to remove',exact:true}).waitFor();
    pass(label+': failed removal restores reaction and count');
    if(width===320){
      await video.locator('.reaction-add').evaluate(button=>button.scrollIntoView({block:'start'}));
      await open(video);
      if(await selector.evaluate(node=>node.scrollHeight>node.clientHeight)){
        await swipe(page,selector,true,true);
        await until(async()=>await selector.evaluate(node=>node.scrollTop)>0,'limited upward menu scrolls by touch');
        await act(selector.getByRole('button',{name:'Angry',exact:true}));await selector.waitFor({state:'detached'});
        await video.getByRole('button',{name:'Your reaction: Angry. Click to remove',exact:true}).waitFor();
        pass('Narrow phone: all upward-menu choices remain reachable when space above is limited');
      }
    }
    assert.deepEqual(errors,[]);await context.close();
  }
  const page=await browser.newPage({viewport:{width:375,height:812},hasTouch:true,isMobile:true});
  await page.route('**/tests/reaction-poster.svg',route=>route.fulfill({contentType:'image/svg+xml',body:poster}));
  await page.route('https://reaction-test.supabase.co/**',route=>{
    const data=route.request().postDataJSON();return route.fulfill({json:data.p_ids?.map(id=>({media_id:id,counts:{like:1,love:1},own_reaction:null}))??null});
  });
  await page.goto(base+'/tests/media-reactions.html?guest');await page.getByRole('button',{name:'Like: 1. See who reacted',exact:true}).first().waitFor();
  assert.equal(await page.locator('.reaction-add,.reaction-selected').count(),0);pass('Guest sees counts with no mutation controls');await page.close();
  console.log(`Passed ${checks} responsive reaction checks.`);
}catch(error){
  const page=browser.contexts().at(-1)?.pages().at(-1);
  if(page){
    await page.screenshot({path:'.runtime/reactions-failure.png'});
    console.error('Layout:',await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,innerWidth,offenders:[...document.querySelectorAll('body, main, section, header, article, .mg-grid, .mg-card-body, .reaction-row, .reaction-summary, .reaction-details')].map(node=>({tag:node.tagName,class:node.className,width:node.getBoundingClientRect().width,right:node.getBoundingClientRect().right,cssWidth:getComputedStyle(node).width,minWidth:getComputedStyle(node).minWidth})).filter(node=>node.right>document.documentElement.clientWidth+1)})));
    console.error('Failure UI:',await page.locator('.reaction-add,.reaction-bar,[role="dialog"]').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),expanded:node.getAttribute('aria-expanded'),disabled:node.disabled,rect:node.getBoundingClientRect().toJSON()}))));
  }
  throw error;
}finally{await browser.close();}
