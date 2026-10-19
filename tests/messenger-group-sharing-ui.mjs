import assert from 'node:assert/strict';
const {chromium,firefox,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.BROWSER_ENGINE||'chromium';
const browser=await ({chromium,firefox,webkit}[engine]).launch({headless:true,...(engine==='chromium'?{channel:process.env.BROWSER_CHANNEL||'msedge'}:{})});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5220';
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',cid='ffffffff-ffff-4fff-8fff-ffffffffffff';
let checks=0;const pass=label=>{checks++;console.log('PASS '+label);};
try {
 for(const [width,height] of [[1440,1000],[390,844]]) {
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];
  const transportFailures=[];
  page.on('requestfailed',request=>transportFailures.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('pageerror',e=>{errors.push(e.message);console.error('Fixture page exception:',e.name,e.stack);});
  let deleted=false,fail=false,hold=false,release,deleteCalls=0,saveCalls=0,name='Family',sharedAvailable=true,membership=true,sendRealtime=true;
  let users=[],groups=[];
  const conv=role=>({id:cid,kind:'group',name,updated_at:new Date().toISOString(),last_sequence:0,cleared_sequence:0,hidden:false,muted:false,role:role==='group-admin'?'admin':role==='member'?'member':'owner',can_delete_group:role==='owner',can_send:true,unread:0,latest:null,members:[{id:a,name:'Owner',role:'owner',online:true},{id:b,name:'Member',role:'member',online:true}]});
  const event=detail=>page.evaluate(detail=>window.dispatchEvent(new CustomEvent('fixture-chat-event',{detail})),detail);
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/fixture-shared-image')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQqDjxHwAEnAJobhvlygAAAABJRU5ErkJggg==','base64')});
   if(url.origin===new URL(base).origin&&!/^\/(rest|storage|functions|auth)\/v1\//.test(url.pathname))return route.continue();
   const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Apikey, Content-Type, X-Client-Info','Access-Control-Allow-Methods':'GET, HEAD, POST, OPTIONS'};
   const respond=options=>route.fulfill({...options,headers:{...cors,...options.headers}});
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
   if(url.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});
   const rpc=url.pathname.split('/').at(-1),body=request.postDataJSON()||{};
   const role=new URL(page.url()).searchParams.get('role')||'owner';
   if(rpc==='is_admin')return respond({json:role==='admin'});
   if(rpc==='shared_media_ids')return respond({json:sharedAvailable?[body.p_type==='video'?'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee':'dddddddd-dddd-4ddd-8ddd-dddddddddddd']:[]});
   if(['videos','photos'].includes(rpc))return respond({json:sharedAvailable?[{id:rpc==='videos'?'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee':'dddddddd-dddd-4ddd-8ddd-dddddddddddd',owner_id:a,file_name:rpc==='videos'?'Shared video.mp4':'Shared photo.jpg',visibility:'private',storage_path:a+'/photo.jpg',preview_path:a+'/preview.webp',processing_status:'ready',mime_type:'image/jpeg',created_at:'2026-01-01'}]:[]});
   if(rpc==='get_storage_base_path')return respond({json:''});
   if(rpc==='get_media_reactions')return respond({json:[]});
   if(url.pathname.includes('/storage/v1/object/sign/'))return respond({status:403,json:{error:'No signing permission'}});
   if(rpc==='serve-shared-image')return respond(sharedAvailable?{json:{url:base+'/fixture-shared-image'}}:{status:403,json:{error:'Access denied'}});
   if(rpc==='messenger_rpc'){
    const data=body.p_data||{};let result={};
    if(body.p_action==='inbox')result={conversations:deleted||role==='admin'||(!membership&&role==='member')?[]:[conv(role)],unread:0};
    else if(body.p_action==='conversation'){
     if(deleted||(!membership&&role==='member'))return respond({status:403,json:{code:'42501',message:'Access denied'}});
     result=conv(role);
    } else if(['messages','snapshot','since','files'].includes(body.p_action))result=[];
    else if(body.p_action==='people')result={users:[{id:b,name:'Member',online:true,unread:0,conversation_id:null}],next:null};
    else if(body.p_action==='group-name'){name=data.text;await event({conversation_id:cid});}
    else if(body.p_action==='create'){name=data.text;result={id:cid};}
    return respond({json:result});
   }
   if(rpc==='messenger_groups_rpc'){
    if(body.p_action==='admin-list')return respond({json:deleted?[]:[{id:cid,name,owner:'Owner',member_count:2}]});
    deleteCalls++;if(hold)await new Promise(resolve=>release=resolve);
    if(fail)return respond({status:403,json:{code:'42501',message:'Deletion permission denied'}});
    deleted=true;if(sendRealtime)await event({conversation_id:cid,kind:'group-deleted'});return respond({json:{}});
   }
   if(rpc==='media_sharing_rpc'){
    if(body.p_action==='get')return respond({json:{users,groups:[{id:cid,name:'Family'}],selected_groups:groups,revision:'fixture-revision',visibility:'private'}});
    assert.equal(body.p_data.revision,'fixture-revision');
    saveCalls++;if(fail)return respond({status:400,json:{code:'P0001',message:'Sharing unavailable'}});
    users=body.p_data.users.map(id=>({id,name:'Member'}));groups=body.p_data.groups;return respond({json:{}});
   }
   if(url.pathname.startsWith('/rest/v1/')&&!url.pathname.includes('/rpc/'))return respond({json:[]});
   return respond({json:{}});
  });
  const navigate=async url=>{await page.evaluate(()=>window.fixtureUnmount?.());await page.waitForLoadState('networkidle');await page.goto(url);};
  const load=async(role='owner',selected=true)=>navigate(`${base}/tests/messenger-group-sharing.html?role=${role}#/messages${selected?'?conversation='+cid:''}`);
  const menu=async()=>{await page.getByRole('button',{name:'Actions for '+name,exact:true}).click();};
  await load();await menu();
  await page.getByRole('menuitem',{name:'Edit Group',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Edit Group',exact:true});await dialog.getByLabel('Group name').fill('Family edited');
  await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);
  await dialog.getByRole('button',{name:'Close',exact:true}).last().click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Keep Editing'}).click();assert.equal(await dialog.getByLabel('Group name').inputValue(),'Family edited');
  await dialog.getByRole('button',{name:'Save name',exact:true}).click();await page.getByRole('heading',{name:'Family edited',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Close',exact:true}).last().click();await menu();await page.getByRole('menuitem',{name:'Manage Members',exact:true}).click();
  await page.getByRole('dialog',{name:'Manage Members',exact:true}).getByRole('button',{name:'Close',exact:true}).last().click();
  pass(width+'px: owner Edit Group and Manage Members; dirty draft survives Keep Editing; modal ignores Escape');
  for(const [kind,file] of [['video','Private video.mp4'],['photo','Private photo.jpg']]){
   users=[];groups=[];
   await page.getByRole('button',{name:'Actions for '+file,exact:true}).click();await page.getByRole('menuitem',{name:'Share',exact:true}).click();
   dialog=page.getByRole('dialog',{name:'Share content',exact:true});await dialog.getByRole('checkbox',{name:'Family',exact:true}).check();
   await page.screenshot({path:`.runtime/group-sharing-${engine}-${width}-${kind}.png`});
   await dialog.locator('.chat-people-items button').filter({hasText:'Member'}).click();
   await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
   assert.deepEqual(groups,[cid]);assert.deepEqual(users.map(u=>u.id),[b]);
   await page.getByRole('button',{name:'Actions for '+file,exact:true}).click();await page.getByRole('menuitem',{name:'Share',exact:true}).click();
   dialog=page.getByRole('dialog',{name:'Share content',exact:true});await dialog.getByRole('checkbox',{name:'Family',exact:true}).uncheck();const before=saveCalls;
   await dialog.getByRole('button',{name:'Save',exact:true}).click();let confirmation=page.getByRole('alertdialog',{name:'Remove shared access'});
   await page.keyboard.press('Escape');assert.equal(await confirmation.isVisible(),true);await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(saveCalls,before);assert.deepEqual(groups,[cid]);
   await dialog.getByRole('button',{name:'Save',exact:true}).click();fail=true;
   confirmation=page.getByRole('alertdialog');await confirmation.getByRole('button',{name:'Save sharing',exact:true}).click();await confirmation.getByRole('alert').waitFor();assert.deepEqual(groups,[cid]);
   fail=false;await confirmation.getByRole('button',{name:'Save sharing',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual(groups,[]);
   pass(width+'px: '+kind+' People + Groups save; revocation requires confirmation, Cancel preserves grants, errors stay in confirmation and retry succeeds');
  }
  await menu();await page.getByRole('menuitem',{name:'Delete Group with Content',exact:true}).click();
  dialog=page.getByRole('alertdialog',{name:'Delete this group for everyone?',exact:true});assert.match(await dialog.innerText(),/Family edited/);
  await page.mouse.click(2,2);await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);assert.equal(deleteCalls,0);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(deleted,false);
  await menu();await page.getByRole('menuitem',{name:'Delete Group with Content',exact:true}).click();dialog=page.getByRole('alertdialog');fail=true;
  await dialog.getByRole('button',{name:'Delete Group',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(deleted,false);
  fail=false;hold=true;sendRealtime=false;await dialog.getByRole('button',{name:'Delete Group',exact:true}).click();await dialog.getByRole('button',{name:'Deleting…',exact:true}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);const calls=deleteCalls;
  await page.keyboard.press('Enter');assert.equal(deleteCalls,calls);release();hold=false;await dialog.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Your conversations',exact:true,includeHidden:true}).waitFor({state:'attached'});assert.equal(new URL(page.url()).hash.includes('conversation='),false);assert.equal(await page.getByRole('button',{name:/Family edited No messages yet/}).count(),0);
  sendRealtime=true;pass(width+'px: deletion requires explicit confirmation; outside/Escape ignored; failure retained; pending prevents duplicate submit; successful deletion removes thread/card even without realtime');
  deleted=false;name='Family';for(const role of ['member','group-admin']){await load(role);await menu();assert.equal(await page.getByRole('menuitem',{name:'Delete Group with Content',exact:true}).count(),0);await page.keyboard.press('Escape');}
  await load('admin',false);await page.getByRole('button',{name:'Actions for Messages',exact:true}).click();await page.getByRole('menuitem',{name:'Manage all groups (Site Administrator)',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Site administrator: Manage all groups'});await dialog.getByRole('button',{name:'Delete Group with Content — Family',exact:true}).click();
  let confirmation=page.getByRole('alertdialog');assert.match(await confirmation.innerText(),/Site administrator action/);await confirmation.getByRole('button',{name:'Delete Group',exact:true}).click();await confirmation.waitFor({state:'hidden'});assert.equal(deleted,true);
  await dialog.getByRole('button',{name:'Close',exact:true}).last().click();
  pass(width+'px: member/group-admin lack global delete; site admin can find/delete nonmember group with explicit administrator warning');
  deleted=false;await load('owner',false);await page.getByRole('button',{name:'Actions for Messages',exact:true}).click();await page.getByRole('menuitem',{name:'Create Group',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Create group',exact:true});assert.equal(await dialog.getByRole('checkbox',{name:'Group conversation'}).isChecked(),true);
  await dialog.getByLabel('Group name').fill('New family');await dialog.locator('.chat-people-items button').filter({hasText:'Member'}).click();await dialog.getByRole('button',{name:'Create group',exact:true}).click();await page.getByRole('heading',{name:'New family',exact:true}).waitFor();
  pass(width+'px: dedicated Create Group menu opens group form and creates owner conversation');
  for(const kind of ['video','photo']){
   sharedAvailable=true;await navigate(`${base}/tests/messenger-group-sharing.html?role=member&library=${kind}#/`);
   await page.getByRole('heading',{name:kind==='video'?'Shared video.mp4':'Shared photo.jpg',exact:true}).waitFor();
   await page.waitForFunction(()=>document.querySelector('img')?.complete&&document.querySelector('img')?.naturalWidth>0);
   await page.getByRole('button',{name:kind==='video'?'Actions for Shared video.mp4':'Actions for Shared photo.jpg',exact:true}).click();
   assert.equal(await page.getByRole('menuitem',{name:'Share',exact:true}).count(),0);assert.equal(await page.getByRole('menuitem',{name:'Delete',exact:true}).count(),0);await page.keyboard.press('Escape');
   membership=false;sharedAvailable=false;await event({conversation_id:cid,kind:'group-access',revoked:true});
   await page.getByRole('heading',{name:kind==='video'?'Shared video.mp4':'Shared photo.jpg',exact:true}).waitFor({state:'detached'});
   membership=true;sharedAvailable=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await page.getByRole('heading',{name:kind==='video'?'Shared video.mp4':'Shared photo.jpg',exact:true}).waitFor();
   pass(width+'px: shared '+kind+' preview/read-only card disappears on revocation; authorized reconnect restores it after a missed re-addition event');
  }
  await page.evaluate(()=>window.fixtureUnmount?.());await page.waitForLoadState('networkidle');
  if(errors.length)console.error('Fixture transport failures:',JSON.stringify(transportFailures));
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(`${checks} Messenger group/share browser checks passed (${engine}).`);
} finally {await browser.close();}
