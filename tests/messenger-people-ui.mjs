import assert from 'node:assert/strict';
const { chromium, firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = process.env.BROWSER_TYPE === 'firefox' ? await firefox.launch({headless:true}) : await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5216';
const me = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let checks = 0;
let diagnosticPage, diagnosticName; const directoryCalls = [];
const pass = label => { checks++; console.log('PASS '+label); };
try {
  for (const [name,width,height] of [['Desktop',1440,900],['Tablet',1024,768],['Phone',390,844],['Landscape',844,390]]) {
    const context = await browser.newContext({viewport:{width,height},hasTouch:width<1100});
    const page = await context.newPage(), errors = [];
    diagnosticPage = page; diagnosticName = name; directoryCalls.length = 0;
    if (process.env.PEOPLE_CPU_RATE && process.env.BROWSER_TYPE !== 'firefox') {
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.PEOPLE_CPU_RATE)});
    }
    page.on('pageerror',e=>errors.push(e.message));
    let denied = false, creates = 0, accountChanged = false, existing = true;
    let holdDirectory = false, failDirectory = false; const heldDirectoryRequests = [];
    let people = Array.from({length:112},(_,i)=>({id:`person-${i}`,name:`Person ${String(i).padStart(3,'0')}`,online:i===0,conversation_id:i===0?'direct-0':null,unread:i===0?3:0}));
    const member = (id,label) => ({id,name:label,role:'member',joined_sequence:0,delivered_sequence:0,read_sequence:0,online:true,last_seen:null,blocked:false});
    const conversation = (id,group=false) => ({id,kind:group?'group':'direct',name:group?'Existing group':'Person 000',updated_at:new Date().toISOString(),last_sequence:0,cleared_sequence:0,hidden:false,muted:false,role:group?'owner':'member',can_send:true,unread:group?0:3,latest:null,members:[member(me,'Current user'),member('person-0','Person 000')]});
    await page.route('**/rest/v1/rpc/messenger_rpc',async route=>{
      const body=route.request().postDataJSON(), data=body.p_data;
      let result={};
      switch(body.p_action) {
        case 'people': {
          directoryCalls.push({query:data.query,after:data.after});
          if (holdDirectory) await new Promise(resolve=>heldDirectoryRequests.push(resolve));
          if (failDirectory && data.after) {
            return route.fulfill({status:400,json:{code:'P0001',message:'Fixture directory failure'}});
          }
          const query=String(data.query||'').toLowerCase();
          const filtered=(accountChanged?[{id:'other-person',name:'Other account contact',online:false,conversation_id:null,unread:0}]:people).filter(p=>p.name.toLowerCase().includes(query)||(`email-${p.id}@example.test`).includes(query));
          const offset=data.after?filtered.findIndex(p=>p.id===data.after.id)+1:0;
          const users=filtered.slice(offset,offset+50), more=offset+50<filtered.length;
          result={users,next:more?{id:users.at(-1).id,name:users.at(-1).name}:null}; break;
        }
        case 'inbox': result={conversations:accountChanged?[]:[...(existing?[conversation('direct-0')]:[]),conversation('group-0',true)],unread:3}; break;
        case 'conversation': result=conversation(body.p_conversation,body.p_conversation==='group-0'); break;
        case 'messages': case 'snapshot': case 'since': result=[];break;
        case 'create': {
          creates++;
          await new Promise(resolve=>setTimeout(resolve,150));
          if(denied)return route.fulfill({status:400,json:{code:'P0001',message:'A selected user is unavailable'}});
          result={id:data.kind==='group'?'group-created':data.members[0]==='person-0'?'direct-0':'direct-new'}; existing=true; break;
        }
      }
      await route.fulfill({json:result});
    });
    await page.goto(base+'/tests/messenger-people-ui.html');
    const desktop=width>900, sidebar=page.getByRole('region',{name:'People',exact:true});
    await page.getByRole('region',{name:'Conversations and groups'}).getByRole('button',{name:/Existing group/}).waitFor();
    if(desktop) {
      const list=sidebar.locator('.chat-people-items');
      await list.getByRole('button',{name:/Person 000/}).waitFor();
      assert.equal(await list.locator('.chat-inbox-item').count(),50);
      assert.equal(await list.getByRole('button',{name:/Person 000/}).getByLabel('3 unread messages').count(),1);
      const more = list.locator('.chat-load-more');
      await more.scrollIntoViewIfNeeded();
      const button = await more.boundingBox();
      await page.mouse.move(button.x+button.width/2,button.y+button.height/2);
      await page.mouse.down();
      // A focus/realtime refresh may land between down and up on a slow runner.
      holdDirectory = true;
      const refreshRequest = page.waitForRequest(request=>request.url().endsWith('/rpc/messenger_rpc')&&request.postDataJSON().p_action==='people');
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await refreshRequest;
      assert.equal(await more.isEnabled(),true,'background refresh must not swallow a pagination click');
      await page.mouse.up();
      holdDirectory = false; heldDirectoryRequests.splice(0).forEach(resolve=>resolve());
      await page.waitForFunction(()=>document.querySelector('.chat-desktop-people .chat-people-items').querySelectorAll('.chat-inbox-item').length===100);
      await list.getByRole('button',{name:'More people',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.chat-desktop-people .chat-people-items').querySelectorAll('.chat-inbox-item').length===112);
      assert.equal(await list.evaluate(el=>el.scrollHeight>el.clientHeight),true);
      await sidebar.getByRole('textbox',{name:'Search people'}).fill('Person');
      await page.waitForFunction(()=>document.querySelector('.chat-desktop-people .chat-people-items').querySelectorAll('.chat-inbox-item').length===50);
      failDirectory = true;
      await list.getByRole('button',{name:'More people',exact:true}).click();
      await sidebar.getByRole('alert').filter({hasText:'Fixture directory failure'}).waitFor();
      assert.equal(await list.locator('.chat-inbox-item').count(),50);
      failDirectory = false;
      await list.getByRole('button',{name:'More people',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.chat-desktop-people .chat-people-items').querySelectorAll('.chat-inbox-item').length===100);
      assert.equal(await sidebar.getByRole('alert').count(),0);
      pass(`${name}: failed pagination retains users; retry loads the same page without skipping ahead`);
      await sidebar.getByRole('textbox',{name:'Search people'}).fill('email-person-0@');
      await page.waitForFunction(()=>document.querySelector('.chat-desktop-people .chat-people-items').querySelectorAll('.chat-inbox-item').length===1);
      await list.getByRole('button',{name:/Person 000/}).click();
      await page.waitForFunction(()=>location.hash.includes('direct-0'));
      assert.equal(await sidebar.isVisible(),true);
      await sidebar.locator('.is-active').waitFor();
      assert.equal(creates,1);
      await page.screenshot({path:`.runtime/messenger-people-sidebar-${process.env.BROWSER_TYPE||'chromium'}.png`,fullPage:true});
      pass(`${name}: direct sidebar directory, pagination/scroll, email filter, badges, selection and existing chat reuse`);
      people[0]={...people[0],online:false,unread:0};
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await list.getByText('Offline',{exact:true}).waitFor();
      assert.equal(await list.getByLabel('3 unread messages').count(),0);
      pass(`${name}: existing refresh cycle updates directory presence and unread state`);
      await sidebar.getByRole('textbox',{name:'Search people'}).fill('Person 001');
      await list.getByRole('button',{name:/Person 001/}).waitFor();
      denied=true; await list.getByRole('button',{name:/Person 001/}).click();
      await sidebar.getByRole('alert').filter({hasText:'unavailable'}).waitFor();
      assert.ok(page.url().includes('direct-0')); denied=false;
      pass(`${name}: stale selection denial keeps current conversation and exposes retryable error`);
    } else { assert.equal(await sidebar.isVisible(),false); }
    await page.getByRole('button',{name:'New message',exact:true}).click();
    let dialog=page.getByRole('dialog',{name:'New conversation',exact:true});
    await dialog.getByRole('button',{name:/Person 000/}).waitFor();
    assert.equal(await dialog.locator('.chat-inbox-item').count(),50);
    if(!desktop) await page.screenshot({path:`.runtime/messenger-people-picker-${name.toLowerCase()}-${process.env.BROWSER_TYPE||'chromium'}.png`,fullPage:true});
    await dialog.getByRole('textbox',{name:'Find registered users'}).fill('Person 001');
    await dialog.getByRole('button',{name:/Person 001/}).waitFor();
    assert.equal(await dialog.locator('.chat-inbox-item').count(),1);
    denied=true;await dialog.getByRole('button',{name:/Person 001/}).click();
    await dialog.getByRole('alert').filter({hasText:'unavailable'}).waitFor();
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);
    denied=false;const before=creates;
    await dialog.getByRole('button',{name:/Person 001/}).evaluate(el=>{el.click();el.click();});
    await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>location.hash.includes('direct-new'));
    assert.equal(creates,before+1);
    if(!desktop) { assert.equal(await page.locator('.chat-conversation-list').isVisible(),false); await page.getByRole('button',{name:'Back to conversations'}).click(); }
    pass(`${name}: mobile/task list starts populated, filters, stays open on error/Escape, selects once then closes`);
    await page.getByRole('button',{name:'New message',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'New conversation',exact:true});
    await dialog.getByRole('checkbox',{name:'Group conversation'}).check();
    dialog=page.getByRole('dialog',{name:'Create group',exact:true});
    await dialog.getByLabel('Group name').fill('New test group');
    await dialog.getByRole('button',{name:/Person 000/}).click();
    await dialog.getByRole('button',{name:/Person 001/}).click();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Keep Editing',exact:true}).click();
    assert.equal(await dialog.getByLabel('Group name').inputValue(),'New test group');
    await dialog.getByRole('button',{name:'Create group',exact:true}).click();
    await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>location.hash.includes('group-created'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const bounds=await page.locator('.chat-workspace').boundingBox();assert.ok(bounds.width<=width);
    pass(`${name}: group selection/create and draft guard retained; layout fits viewport`);
    if(desktop){
      people=people.filter(p=>p.id!=='person-1');
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await sidebar.getByText('No matching users.',{exact:true}).waitFor();
      pass(`${name}: refresh removes newly unavailable contacts`);
      accountChanged=true;
      await page.getByRole('button',{name:'Switch fixture account'}).click();
      await sidebar.getByRole('button',{name:/Other account contact/}).waitFor();
      assert.equal(await sidebar.getByText('Person 000',{exact:true}).count(),0);
      pass(`${name}: changing accounts clears directory cache/search and previous contacts`);
    }
    await page.screenshot({path:`.runtime/messenger-people-${name.toLowerCase()}-${process.env.BROWSER_TYPE||'chromium'}.png`,fullPage:true});
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log(`Messenger people UI: ${checks} checks passed`);
} catch(cause) {
  console.error('People fixture failure', {profile:diagnosticName,requests:directoryCalls.slice(-12),state:await diagnosticPage?.evaluate(()=>{
    const list=document.querySelector('.chat-desktop-people .chat-people-items'),button=list?.querySelector('.chat-load-more');
    return {count:list?.querySelectorAll('.chat-inbox-item').length,busy:list?.getAttribute('aria-busy'),button:button?.textContent,disabled:button?.disabled,errors:[...document.querySelectorAll('[role=alert]')].map(element=>element.textContent)};
  })});
  throw cause;
} finally {await browser.close();}
