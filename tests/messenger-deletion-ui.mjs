import assert from 'node:assert/strict';
const { chromium, firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = process.env.BROWSER_TYPE === 'firefox' ? await firefox.launch({headless:true}) : await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5220';
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let checks = 0;
const pass = label => { checks++; console.log('PASS '+label); };
try {
  for (const [name,width,height] of [['Desktop',1440,900],['Mobile',390,844]]) {
    const context = await browser.newContext({viewport:{width,height}}), pages = [], errors = [];
    const hidden = new Map([[a,new Set()],[b,new Set()]]), deleted = new Set();
    let deny = false, deletes = 0, hold = false, held = [];
    const row = (id,sequence,sender=a,extra={}) => ({id,sequence,sender_id:sender,sender_name:sender===a?'Author':'Recipient',conversation_id:'chat',body:id,created_at:new Date().toISOString(),edited_at:null,deleting:false,deleted:false,reply:null,attachments:[],reactions:[],...extra});
    const rows = [row('self-target',51),row('everyone-target',52,a,{attachments:[{id:'file',name:'test.txt',mime_type:'text/plain',file_size:5,available:true}],reactions:[{user_id:b,name:'Recipient',reaction:'love'}]}),row('reply',53,b,{reply:{id:'everyone-target',sender_name:'Author',body:'everyone-target'}}),row('denied-target',54),row('recipient-message',55,b)];
    const older = Array.from({length:50},(_,i)=>row('older-'+i,i+1));
    const visible = (account,items=rows) => items.filter(m=>!deleted.has(m.id)&&!hidden.get(account).has(m.id)).map(m=>({...m,reply:m.reply&&deleted.has(m.reply.id)?{...m.reply,body:'Original message deleted'}:m.reply}));
    const member = id => ({id,name:id===a?'Author':'Recipient',role:'member',joined_sequence:0,delivered_sequence:55,read_sequence:55,online:true,last_seen:null,blocked:false});
    const convo = account => ({id:'chat',kind:'direct',name:account===a?'Recipient':'Author',updated_at:new Date().toISOString(),last_sequence:55,cleared_sequence:0,hidden:false,muted:false,role:'member',can_send:true,unread:0,latest:visible(account).at(-1),members:[member(a),member(b)]});
    for (const account of [a,a,b]) {
      const page = await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',async route=>{
        const url = route.request().url();
        if(url.startsWith(base)) return route.continue();
        if(url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({contentType:'text/css',body:''});
        if(!url.includes('/rest/v1/rpc/messenger_rpc')) return route.fulfill({json:{}});
        const who = route.request().headers().authorization === 'Bearer '+b ? b : a;
        const body = route.request().postDataJSON(), data = body.p_data;
        let result = {};
        switch(body.p_action) {
          case 'inbox': result={conversations:[convo(who)],unread:0};break;
          case 'conversation': result=convo(who);break;
          case 'messages': result=data.before?visible(who,older).filter(m=>m.sequence<data.before).slice(-50):visible(who,[...older,...rows]).slice(-50);break;
          case 'snapshot': result=visible(who,[...older,...rows]).filter(m=>data.ids.includes(m.id)); if(hold){ await new Promise(resolve=>held.push(resolve)); } break;
          case 'since': result=[];break;
          case 'people': result={users:[],next:null};break;
          case 'files': result=deleted.has('everyone-target')||hidden.get(who).has('everyone-target')?[]:[{id:'file',name:'test.txt',mime_type:'text/plain',file_size:5,message_id:'everyone-target'}];break;
          case 'search': result=visible(who).filter(m=>m.body.includes(data.query));break;
          case 'delete-for-self': case 'delete-for-everyone': {
            deletes++;
            if(deny) return route.fulfill({status:400,json:{code:'42501',message:'Deletion permission denied'}});
            if(body.p_action==='delete-for-self') hidden.get(who).add(data.id); else deleted.add(data.id);
            const targets=pages.filter(p=>body.p_action==='delete-for-everyone'||p.account===who);
            await Promise.all(targets.map(p=>p.page.evaluate(detail=>window.dispatchEvent(new CustomEvent('fixture-chat-event',{detail})),{conversation_id:'chat',message_id:data.id,kind:body.p_action==='delete-for-self'?'hidden':'deleted'})));
            break;
          }
        }
        await route.fulfill({json:result});
      });
      await page.goto(base+'/tests/messenger-deletion-ui.html?account='+(account===b?'b':'a')+'#/messages?conversation=chat');
      await page.locator('[data-message-id="self-target"]').waitFor();
      pages.push({page,account});
      page.on('console',message=>{if(message.type()==='error' && message.text()!=='Failed to load resource: the server responded with a status of 400 (Bad Request)') errors.push(message.text());});

    }
    const [first,second,recipient] = pages.map(p=>p.page);
    const card = (page,id) => page.locator(`[data-message-id="${id}"]`);
    const chooseDelete = async (page,id,scope) => {
      await card(page,id).getByRole('button',{name:'Actions for message',exact:true}).click();
      await page.getByRole('menuitem',{name:'Delete message',exact:true}).click();
      const dialog=page.getByRole('alertdialog',{name:'Delete message',exact:true});
      await dialog.getByRole('radio',{name:new RegExp(scope==='self'?'Delete for myself':'Delete for everyone')}).check();
      return dialog;
    };
    let dialog = await chooseDelete(first,'self-target','self');
    await first.keyboard.press('Escape'); assert.equal(await dialog.isVisible(),true); assert.equal(deletes,0);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click(); assert.equal(await card(first,'self-target').count(),1);
    pass(name+': confirmation required; Escape does not dismiss and Cancel preserves the complete message');
    hold=true; await first.evaluate(()=>window.dispatchEvent(new Event('focus')));
    for(let n=0;!held.length&&n<100;n++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(held.length,'snapshot held before delete');
    dialog=await chooseDelete(first,'self-target','self');
    await dialog.getByRole('button',{name:'Delete for myself',exact:true}).click();
    await card(first,'self-target').waitFor({state:'detached'}); await card(second,'self-target').waitFor({state:'detached'});
    assert.equal(await card(recipient,'self-target').count(),1);
    hold=false; held.splice(0).forEach(resolve=>resolve());
    await first.waitForTimeout(250);
    assert.equal(await card(first,'self-target').count(),0);
    pass(name+': self deletion removes full cards in both own sessions, retains recipient card and rejects delayed pre-delete snapshots');
    dialog=await chooseDelete(first,'denied-target','everyone'); deny=true;
    await dialog.getByRole('button',{name:'Delete for everyone',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'permission denied'}).waitFor();
    assert.equal(await card(first,'denied-target').count(),1); assert.equal(await dialog.isVisible(),true);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click(); deny=false;
    pass(name+': failed authorization keeps card and confirmation error intact');
    await second.getByRole('button',{name:'Actions for Recipient',exact:true}).click();
    await second.getByRole('menuitem',{name:'Shared media & files',exact:true}).click();
    const filesDialog=second.getByRole('dialog',{name:'Shared media & files',exact:true});
    await filesDialog.getByText('test.txt',{exact:true}).waitFor();
    await recipient.getByRole('button',{name:'Actions for Author',exact:true}).click();
    await recipient.getByRole('menuitem',{name:'Search conversation',exact:true}).click();
    const searchDialog=recipient.getByRole('dialog',{name:'Search · Author',exact:true});
    await searchDialog.getByRole('textbox').fill('everyone-target');
    await searchDialog.locator('.chat-search-result').waitFor();
    dialog=await chooseDelete(first,'everyone-target','everyone');
    await dialog.getByRole('button',{name:'Delete for everyone',exact:true}).click();
    for(const page of [first,second,recipient]) {
      await card(page,'everyone-target').waitFor({state:'detached'});
      await card(page,'reply').getByText('Original message deleted',{exact:true}).waitFor();
      assert.equal(await page.getByText('This message was deleted.',{exact:true}).count(),0);
      assert.equal(await page.locator('.chat-message').count(),await page.locator('.chat-message-bubble').count());
      assert.equal(await page.locator('.chat-attachment').count(),0);
    }
    assert.equal(deletes,3);
    assert.equal(await searchDialog.locator('.chat-search-result').count(),0);
    assert.equal(await filesDialog.locator('.chat-attachment').count(),0);
    await searchDialog.getByRole('button',{name:'Close',exact:true}).last().click();
    await filesDialog.getByRole('button',{name:'Close',exact:true}).last().click();
    pass(name+': global broadcast removes entire card, attachments and reactions for all sessions; surviving reply stays usable');
    await first.evaluate(()=>{location.hash='#/messages';});
    await first.locator('.chat-welcome').waitFor({state:'attached'});
    await first.evaluate(()=>{location.hash='#/messages?conversation=chat';});
    await card(first,'reply').waitFor(); assert.equal(await card(first,'self-target').count(),0); assert.equal(await card(first,'everyone-target').count(),0);
    await first.goBack(); await first.locator('.chat-welcome').waitFor({state:'attached'});
    await first.goForward(); await card(first,'reply').waitFor();
    assert.equal(await card(first,'self-target').count(),0); assert.equal(await card(first,'everyone-target').count(),0);
    await first.reload(); await card(first,'reply').waitFor();
    assert.equal(await card(first,'everyone-target').count(),0);
    await first.waitForTimeout(250);
    // Invoke the control without scrolling it into view: scrolling to the top
    // itself starts automatic pagination and may remove the button mid-click.
    await first.getByRole('button',{name:'Load older messages',exact:true}).evaluate(button=>button.click());
    await card(first,'older-0').waitFor();
    assert.equal(await card(first,'self-target').count(),0); assert.equal(await card(first,'everyone-target').count(),0);
    // Reconnect/focus follows the same real provider refresh path.
    await first.evaluate(()=>window.dispatchEvent(new Event('online')));
    await first.waitForTimeout(200); assert.equal(await card(first,'everyone-target').count(),0);
    pass(name+': navigation, reload and reconnect do not restore deleted cards');
    await first.getByRole('button',{name:'Switch fixture account',exact:true}).click();
    await card(first,'self-target').waitFor();
    assert.equal(await card(first,'everyone-target').count(),0);
    pass(name+': per-user deletion cache resets on account change; recipient still sees message hidden by the first user');
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log(`Messenger deletion UI: ${checks} checks passed`);
} finally { await browser.close(); }
