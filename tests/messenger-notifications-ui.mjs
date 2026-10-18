import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const states=new Map();
const appPath=process.env.NOTIFICATION_BASE_PATH || '/video/';
// A real loopback backend is necessary: WebKit does not reliably expose requests
// controlled by a service worker to Playwright's network interception APIs.
const server=await createServer({configFile:false,root:process.cwd(),base:appPath,cacheDir:path.resolve('.runtime/vite-notification-'+appPath.replace(/\W/g,'_')),plugins:[react(),{name:'notification-backend',configureServer(server){
  server.middlewares.use(async(request,response,next)=>{
    if(!request.url?.startsWith('/rest/v1/rpc/'))return next();
    const id=/notification-fixture=([^;]+)/.exec(request.headers.cookie || '')?.[1];
    const state=states.get(id);if(!state){response.statusCode=403;response.end();return;}
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const {p_action:action,p_data:data={}}=JSON.parse(Buffer.concat(chunks).toString()||'{}');
    let result={},status=200;
    if(request.url.endsWith('/messenger_notifications_rpc')){
      if(action==='settings'||action==='preferences'){
        if(action==='preferences') {if(state.fail){status=400;result={code:'P0001',message:'Fixture save failed'};}else state.preferences={...state.preferences,...data};}
        if(status===200)result={preferences:state.preferences,available:true,public_key:key,muted_conversations:state.mutedConversations};
      }
      if(action==='events'){state.feedRequests.push(data);if(state.failEvents){status=503;result={message:'Fixture offline'};}else result={cursor:state.events.length,events:state.events.slice(data.after??0)};}
      if(action==='subscribe'){state.subscriptions++;result={id:device};}
      if(action==='device')result={enabled:true};
      if(action==='delivery-claim')result=state.deviceInvalid?{action:'local',payload:state.events.find(event=>event.id===data.id)}:state.pushOwnedIds?.has(data.id)?{action:'push'}:{action:'page',lease:device,payload:state.events.find(event=>event.id===data.id)};
      if(action==='delivery-ack')state.deliveryAcks=(state.deliveryAcks??0)+1;
    }else if(request.url.endsWith('/messenger_calls_rpc')){
      result=[];
      if(action==='inbox')result=state.incoming?[state.incoming]:[];
      if(action==='decline'){state.declines++;state.incoming=null;result={};}
      if(action==='accept'){state.accepts++;status=400;result={code:'P0001',message:'Fixture media not captured'};}
    }else if(action==='inbox')result={conversations:[],unread:0};
    response.statusCode=status;response.setHeader('Content-Type','application/json');response.end(JSON.stringify(result));
  });
}}],envPrefix:[],resolve:{alias:{'@':path.resolve('src')}},define:{'import.meta.env.VITE_SUPABASE_URL':'window.location.origin','import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('isolated-fixture')},server:{host:'127.0.0.1',port:0}});
await server.listen();
const engines=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine=process.env.BROWSER_ENGINE || 'chromium';
const browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{channel:process.env.BROWSER_CHANNEL || 'msedge'}:{})});
const base=`http://127.0.0.1:${server.httpServer.address().port}${appPath.replace(/\/$/,'')}`;
const cid='11111111-1111-4111-8111-111111111111',cid2='22222222-2222-4222-8222-222222222222';
const me='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', caller='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const device='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const key='B'.repeat(87);
const defaults={notify_messages:true,notify_voice_calls:true,notify_video_calls:true,show_message_preview:true,sound_enabled:true};
let checks=0;const pass=label=>{checks++;console.log('PASS '+engine+' '+label);};
const contexts=[];
let diagnosticPage,diagnosticState;
function event(kind='message',conversation=cid) {return {id:randomUUID(),kind,conversation_id:conversation,message_id:kind==='message'?randomUUID():null,call_id:kind==='message'?null:randomUUID(),sender_name:'John Smith',body:kind==='message'?'Are you available?':`Incoming ${kind==='video'?'Video':'Voice'} Call`,sound:false,expires_at:new Date(Date.now()+40000).toISOString()};}
async function setup(viewport={width:1280,height:900},{permission='default',muted=[]}={}) {
  const context=await browser.newContext({viewport,hasTouch:viewport.width<1000});contexts.push(context);
  const state={events:[],preferences:{...defaults},permissionRequests:0,subscriptions:0,declines:0,accepts:0,incoming:null,fail:false,feedRequests:[],mutedConversations:muted};
  const fixtureId=randomUUID();states.set(fixtureId,state);await context.addCookies([{name:'notification-fixture',value:fixtureId,url:new URL(base).origin}]);
  await context.addInitScript(({permission,key})=>{
    window.__permissionRequests=0;window.__subscriptions=0;window.__permission=permission;window.__subscription=null;
    // Explicitly fake user permission/provider enrollment, never subscribe a real
    // test machine to a production endpoint. SW/IndexedDB remain real browser APIs.
    if('Notification' in window){
      Object.defineProperty(Notification,'permission',{configurable:true,get:()=>window.__permission});
      Notification.requestPermission=async()=>{window.__permissionRequests++;window.__permission='granted';return 'granted';};
    }
    if('PushManager' in window){
      PushManager.prototype.getSubscription=async()=>window.__subscription;
      PushManager.prototype.subscribe=async options=>{window.__subscriptions++;window.__subscription={options,endpoint:'https://fcm.googleapis.com/fcm/send/fixture',toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:key,auth:'a'.repeat(22)}}),unsubscribe:async()=>{window.__subscription=null;return true;}};return window.__subscription;};
    }
  },{permission,key});
  const page=await context.newPage(),errors=[];page.on('pageerror',cause=>errors.push(cause.message));
  diagnosticPage=page;diagnosticState={state,errors};
  await page.goto(base+'/tests/messenger-notifications.html');
  await page.waitForFunction(()=>document.body.dataset.notificationReady==='true');
  await page.getByText(permission==='denied'?/Notifications blocked|unsupported/:/Permission not requested|unsupported/).first().waitFor();
  for(let attempt=0;attempt<30&&!state.feedRequests.length;attempt++)await page.waitForTimeout(100);
  const core=async(code,arg)=>page.evaluate(async({code,arg})=>{const core=window.MyhostageNotifications;return new Function('core','arg',`return (async()=>{${code}})()`)(core,arg);},{code,arg});
  const check=async()=>{await page.getByRole('button',{name:'Check notifications',exact:true}).click();await page.waitForTimeout(200);};
  return {page,context,state,errors,check,core};
}
try {
  for(const [name,viewport] of [['desktop',{width:1280,height:900}],['tablet',{width:768,height:1024}],['mobile',{width:390,height:844}]]) {
    const {page,state,check,errors,core}=await setup(viewport);
    assert.equal(await page.evaluate(()=>window.__permissionRequests),0);
    await page.getByLabel('Untouched draft').fill('Keep my draft');
    state.events.push(event());await check();const card=page.getByRole('article',{name:'New message from John Smith'});await card.waitFor();
    const bounds=await card.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height);
    assert.equal(await card.evaluate(node=>getComputedStyle(node).borderRadius),'16px');
    const payload=state.events[0];
    await page.evaluate(async ({payload,owner})=>{const registration=await navigator.serviceWorker.ready;registration.active.postMessage({type:'deliver-notification',payload,owner});},{payload,owner:me});
    await page.waitForTimeout(200);assert.equal(await page.locator('.messenger-notification-card').count(),1);
    await card.getByRole('button',{name:/John Smith/}).click();await page.waitForFunction(cid=>location.hash.includes('conversation='+cid),cid);
    assert.equal(await page.evaluate(()=>location.hash.includes('notification=1')),false,'active notification navigation must not leave a guest sign-in marker');
    await card.waitFor({state:'detached'});assert.equal(await page.getByLabel('Untouched draft').inputValue(),'Keep my draft');
    state.events.push(event());await check();assert.equal(await page.locator('.messenger-notification-card').count(),0);
    await page.evaluate(()=>location.hash='#/');state.events.push(event());await check();await page.getByRole('article').waitFor();
    await page.getByRole('button',{name:'Dismiss notification'}).click();await page.getByRole('article').waitFor({state:'detached'});
    state.events.push(event('message',cid2),event('message',cid),event('message',cid2));await check();
    await page.waitForFunction(()=>document.querySelectorAll('.messenger-notification-card').length===2);
    assert.equal(await page.evaluate(()=>window.__permissionRequests),0);
    state.fail=true;await page.getByLabel('Show message previews').click();await page.getByRole('alert').filter({hasText:'Fixture save failed'}).waitFor();assert.equal(await page.getByLabel('Show message previews').isChecked(),true);
    state.fail=false;await page.getByLabel('Show message previews').click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('label')).find(node=>node.textContent==='Show message previews')?.querySelector('input')?.checked===false);assert.equal(state.preferences.show_message_preview,false);
    const incoming=event('video');state.incoming={id:incoming.call_id,conversation_id:cid,caller_id:caller,caller_name:'John Smith',name:'John Smith',media:'video',state:'ringing',my_state:'invited',mine:false,seen:false,started_at:new Date().toISOString(),answered_at:null,ended_at:null,outcome:null,duration:0,members:[{id:caller,name:'John Smith',state:'joined'},{id:me,name:'You',state:'invited'}]};
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('messenger-call')));
    const incomingCard=page.getByRole('status',{name:'Incoming video call from John Smith'});await incomingCard.waitFor();
    assert.equal(await page.getByRole('dialog').count(),0);
    await incomingCard.getByRole('button',{name:'John Smith Incoming Video Call'}).click();const dialog=page.getByRole('dialog',{name:'John Smith'});await dialog.waitFor();
    await page.mouse.click(1,1);await page.keyboard.press('Escape');assert.equal(await dialog.count(),1);
    await dialog.getByRole('button',{name:'Decline',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(state.declines,1);
    state.incoming={id:randomUUID(),conversation_id:cid,caller_id:caller,caller_name:'John Smith',name:'John Smith',media:'voice',state:'ringing',my_state:'invited',mine:false,seen:false,started_at:new Date().toISOString(),answered_at:null,ended_at:null,outcome:null,duration:0,members:[{id:caller,name:'John Smith',state:'joined'},{id:me,name:'You',state:'invited'}]};
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('messenger-call')));
    const voice=page.getByRole('status',{name:'Incoming voice call from John Smith'});await voice.waitFor();await voice.getByRole('button',{name:'Decline',exact:true}).click();await voice.waitFor({state:'detached'});assert.equal(state.declines,2);
    assert.ok(await core('return await core.claim(arg.id,arg.owner)',{id:randomUUID(),owner:me}));
    await fs.mkdir('.runtime/notifications',{recursive:true});await page.screenshot({path:`.runtime/notifications/${engine}-${name}.png`});
    assert.deepEqual(errors,[]);pass(name+': compact cards, safe routing, same-conversation suppression, realtime/push dedupe, grouping, preference failure, incoming call UI');
    await page.close();
  }
  {
    const {page,state}=await setup(undefined,{permission:'denied'});
    const supported=await page.getByRole('button',{name:'Enable Notifications'}).count();
    if(supported)assert.equal(await page.getByRole('button',{name:'Enable Notifications'}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.__permissionRequests),0);assert.equal(state.subscriptions,0);pass('denied/unsupported permission never prompts again or subscribes');
    if(supported){await page.evaluate(()=>{window.__permission='granted';window.dispatchEvent(new Event('focus'));});await page.getByRole('button',{name:'Enable Notifications'}).click();await page.getByText('Notifications enabled',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__permissionRequests),0);assert.equal(state.subscriptions,1);pass('permission later enabled can enroll without another prompt');}
    await page.close();
  }
  {
    const {page,state,core,context,check}=await setup();
    const enable=page.getByRole('button',{name:'Enable Notifications'});
    if(await enable.count()){
      await enable.click();await page.getByText('Notifications enabled',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__permissionRequests),1);assert.equal(state.subscriptions,1);
      assert.equal((await core("return await core.get('binding')")).device_id,device);
      const second=await context.newPage();await second.goto(base+'/tests/messenger-notifications.html');await second.waitForFunction(()=>document.body.dataset.notificationReady==='true');
      await page.bringToFront();const shared=event();state.events.push(shared);await check();await page.waitForTimeout(500);
      assert.equal(await page.locator('.messenger-notification-card').count()+await second.locator('.messenger-notification-card').count(),1);
      assert.ok(state.deliveryAcks>0,'page delivery acknowledges the server lease');
      const pushed=event('message',cid2);state.pushOwnedIds=new Set([pushed.id]);state.events.push(pushed);await check();
      assert.equal(await page.locator('.messenger-notification-card').count()+await second.locator('.messenger-notification-card').count(),1,'provider-owned event cannot also display a foreground card');
      await page.getByRole('button',{name:'Disable on This Device'}).click();await page.getByText('Notifications not enabled on this device',{exact:true}).waitFor();
      await second.close();await page.bringToFront();await page.waitForFunction(()=>document.hasFocus()&&!document.hidden);
      state.deviceInvalid=true;await core("await core.put('binding',arg)",{user_id:me,device_id:device});
      state.events.push({...event('message',cid2),sender_name:'Device Renewal'});await check();
      await page.getByRole('article',{name:'New message from Device Renewal'}).waitFor();
      assert.equal((await core("return await core.get('binding')")).device_id,undefined,'expired subscription falls back to local cards');
      pass('explicit enable, permission gesture, device binding, two-tab single alert and expired-device foreground fallback');
    }else pass('unsupported platform explains capability without prompting');
    await page.getByRole('button',{name:'Log out'}).click();await page.waitForTimeout(300);assert.equal(await core("return await core.get('binding')"),undefined);
    assert.equal(await page.locator('.messenger-notification-card').count(),0);pass('logout clears owner binding and visible alerts');
  }
  {
    const {page,core}=await setup();
    const old=await core('return await core.clearBinding(arg)',randomUUID());assert.equal(old,undefined);
    assert.equal((await core("return await core.get('binding')")).user_id,me);
    const expired=event('video');
    await page.evaluate(payload=>{location.hash=`#/messages?conversation=${payload.conversation_id}&call=${payload.call_id}&notification=1`;window.dispatchEvent(new CustomEvent('messenger-open-call',{detail:payload.call_id}));},expired);
    await page.getByText('This call is no longer ringing. Open Messenger to see its status.').waitFor();
    assert.equal(await page.evaluate(()=>location.hash.includes('notification=1')),false,'authenticated call route consumes sign-in marker');
    assert.equal(await page.getByRole('button',{name:'Accept',exact:true}).count(),0);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    pass('stale call links cannot answer; account-specific binding cleanup cannot clear another account');
  }
  {
    const {page,state,check}=await setup();state.failEvents=true;state.events.push(event());await check();
    assert.equal(await page.getByRole('article').count(),0);
    state.failEvents=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.getByRole('article',{name:'New message from John Smith'}).waitFor();
    pass('failed event delivery reconnects without losing the pending event');
  }
  {
    const {page,state,check}=await setup(undefined,{muted:[cid]});
    state.incoming={id:randomUUID(),conversation_id:cid,caller_id:caller,caller_name:'John Smith',name:'John Smith',media:'voice',state:'ringing',my_state:'invited',mine:false,seen:false,started_at:new Date().toISOString(),answered_at:null,ended_at:null,outcome:null,duration:0,members:[{id:caller,name:'John Smith',state:'joined'},{id:me,name:'You',state:'invited'}]};
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('messenger-call')));await check();await page.waitForTimeout(300);
    assert.equal(await page.getByRole('status',{name:'Incoming voice call from John Smith'}).count(),0);
    state.mutedConversations=[];await check();const incoming=page.getByRole('status',{name:'Incoming voice call from John Smith'});await incoming.waitFor();
    await incoming.getByRole('button',{name:'Decline',exact:true}).click();await incoming.waitFor({state:'detached'});
    pass('muted calls outside the cached inbox stay quiet; unmuting restores the existing call alert');
  }
} catch(cause) {
  console.log('Notification fixture diagnostic',JSON.stringify(diagnosticState));
  if(diagnosticPage&&!diagnosticPage.isClosed())console.log(await diagnosticPage.evaluate(async()=>({visibility:document.visibilityState,focus:document.hasFocus(),binding:await window.MyhostageNotifications?.get('binding'),text:document.body.innerText})));
  throw cause;
} finally {await Promise.all(contexts.map(context=>context.close()));await browser.close();await server.close();}
console.log(`${checks} notification browser groups passed`);
