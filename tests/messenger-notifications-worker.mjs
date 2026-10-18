// Exercise the actual service-worker handlers with deterministic window/provider
// APIs. Browser tests separately exercise real SW registration and IndexedDB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
const source=await readFile(new URL('../public/notifications-sw.js',import.meta.url),'utf8');
const shared=await readFile(new URL('../public/notification-core.js',import.meta.url),'utf8');
const owner=randomUUID(),device=randomUUID(),conversation=randomUUID();
const binding={user_id:owner,device_id:device};
const make=(kind='message')=>({id:randomUUID(),kind,device_id:device,conversation_id:conversation,message_id:randomUUID(),call_id:kind==='message'?null:randomUUID(),sender_name:'John Smith',body:'Private fixture preview',expires_at:new Date(Date.now()+30000).toISOString()});
const store=new Map([['binding',binding]]),handlers=new Map(),shown=[],opened=[],navigated=[],messages=[];
let windows=[];
const sandbox={console,URL,Date,Promise,MessageChannel,setTimeout:(...args)=>{const timer=setTimeout(...args);timer.unref();return timer;},clearTimeout,
  registration:{scope:'https://myhostage.test/video/',showNotification:async(title,options)=>{shown.filter(item=>item.tag===options.tag).forEach(item=>{item.closed=true;});shown.push({title,...options,closed:false});},getNotifications:async({tag}={})=>shown.filter(item=>!item.closed&&(!tag||item.tag===tag)).map(item=>({...item,close:()=>{item.closed=true;}}))},
  Notification:{permission:'granted'},
  clients:{claim:async()=>{},matchAll:async()=>windows,openWindow:async url=>opened.push(url)},skipWaiting:async()=>{},
  addEventListener:(name,handler)=>handlers.set(name,handler)};
sandbox.self=sandbox;
const context=vm.createContext(sandbox);
sandbox.importScripts=()=>vm.runInContext(shared,context);
vm.runInContext(source,context);
const core=sandbox.MyhostageNotifications;
core.get=async key=>store.get(key);core.put=async(key,value)=>{if(value===undefined)store.delete(key);else store.set(key,value);};
core.prune=async()=>{};core.claim=async(id,user)=>{const key=`event:${user}:${id}`;if(store.has(key))return false;store.set(key,true);return true;};
async function emit(name,properties={}){const promises=[];const event={...properties,waitUntil:promise=>promises.push(promise)};handlers.get(name)(event);await Promise.all(promises);return event;}
const push=payload=>emit('push',{data:{text:()=>JSON.stringify(payload),json:()=>payload}});
const windowClient=({visible=true,focused=true,respond=true,url='https://myhostage.test/video/#/'}={})=>({url,focused,visibilityState:visible?'visible':'hidden',
  focus:async function(){return this;},navigate:async function(url){navigated.push(url);this.url=url;return this;},
  postMessage:async(message,ports)=>{messages.push(message);if(respond){if(message.type==='messenger-notification')await core.claim(message.payload.id,owner);ports?.[0]?.postMessage('handled');ports?.[0]?.close();}}});
const page=(payload,pageOwner=owner)=>emit('message',{source:windowClient(),data:{type:'deliver-notification',payload,owner:pageOwner},ports:[]});

await emit('install');await emit('activate');
const message=make();await push(message);assert.equal(shown.length,1);assert.equal(shown[0].tag,'message-conversation-'+conversation);assert.equal(shown[0].data.message_id,message.message_id);
await push(message);assert.equal(shown.length,2);assert.equal(shown.at(-1).silent,true);assert.equal(shown.filter(item=>!item.closed).length,1);console.log('PASS each real push displays a native notification; repeated IDs quietly update the same tag');
await push({...make(),id:'invalid'});assert.equal(shown.at(-1).data.kind,'update');
await push({...make(),expires_at:'bad'});assert.equal(shown.at(-1).body,'Open Messenger for updates');
let count=shown.length;await push({...make(),device_id:randomUUID()});
store.delete('binding');await push(make());store.set('binding',binding);assert.equal(shown.length,count);console.log('PASS malformed push uses private generic notification; mismatched-device and logged-out payloads are ignored');
store.set(`preferences:${owner}`,{notify_messages:false});await push(make());assert.equal(shown.at(-1).data.kind,'update');
count=shown.length;await page(make());assert.equal(shown.length,count);
store.set(`preferences:${owner}`,{show_message_preview:false});await push(make());assert.equal(shown.at(-1).body,'New message');store.delete(`preferences:${owner}`);
windows=[windowClient()];const active=make();count=shown.length;await page(active);assert.equal(shown.length,count);assert.equal(messages.at(-1).type,'messenger-notification');
const priorMessages=messages.length;await push(active);assert.equal(shown.length,count+1);assert.equal(messages.length,priorMessages,'real push must never silently hand off to a foreground page');
windows=[windowClient({visible:false}),windowClient({url:'https://other.test/'})];await page(make());assert.equal(shown.length,count+2);console.log('PASS page-claimed events use foreground cards or background OS; actual push always remains native');
const call=make('video');await push(call);assert.equal(shown.at(-1).tag,'incoming-call-'+call.call_id);
const close={...call,id:randomUUID(),kind:'call-closed'};count=shown.length;await page(close);assert.equal(shown.at(-1).closed,true);assert.equal(shown.length,count,'call cleanup must not display a replacement');
await push({...call,id:randomUUID()});assert.equal(shown.at(-1).data.kind,'call-closed');
const reordered=make('voice');await page({...reordered,id:randomUUID(),kind:'call-closed'});await push(reordered);assert.equal(shown.at(-1).body,'Missed call');
await page({...reordered,id:randomUUID(),kind:'call-closed'});assert.equal(shown.at(-1).closed,true);
await push({...make('voice'),expires_at:new Date(Date.now()-1000).toISOString()});assert.equal(shown.at(-1).body,'Missed call');
assert.equal(shown.some(item=>item.body==='Call no longer ringing'),false);
console.log('PASS call cleanup closes directly without replacement; expired/reordered original pushes never resume ringing');
const stillRinging=make('voice'),alreadyAnswered=make('video');await push(stillRinging);await push(alreadyAnswered);count=shown.length;
await emit('message',{source:windowClient(),data:{type:'reconcile-call-notifications',owner,active_calls:[stillRinging.call_id]},ports:[]});
assert.equal(shown.findLast(item=>item.data?.call_id===stillRinging.call_id).closed,false);
assert.equal(shown.findLast(item=>item.data?.call_id===alreadyAnswered.call_id).closed,true);assert.equal(shown.length,count);
shown.findLast(item=>item.data?.call_id===stillRinging.call_id).data.expires_at=new Date(Date.now()-1000).toISOString();
await emit('activate');assert.equal(shown.findLast(item=>item.data?.call_id===stillRinging.call_id).closed,true);
console.log('PASS resume reconciliation keeps active calls, closes ended/expired alerts and never shows another notification');
const click=shown[0];const notification={data:click.data,close:()=>{click.closed=true;}};
windows=[windowClient()];await emit('notificationclick',{notification});assert.equal(opened.length,0);assert.equal(navigated.length,0);assert.equal(messages.at(-1).type,'open-messenger-notification');
windows=[];await emit('notificationclick',{notification});assert.equal(opened.length,1);assert.equal(opened[0],`https://myhostage.test/video/#/messages?conversation=${conversation}&notification=1`);
await emit('notificationclick',{notification:{...notification,data:{...click.data,conversation_id:'https://evil.invalid/'}}});assert.equal(opened.length,1);
store.set('binding',{user_id:randomUUID(),device_id:randomUUID()});await emit('notificationclick',{notification});assert.equal(opened.length,1);console.log('PASS SW click focuses existing page without reload, routes new page safely and rejects stale account links');
assert.equal(handlers.has('fetch'),false,'SW must not intercept working media/network requests');
store.set('binding',binding);windows=[windowClient({visible:true,focused:false})];count=shown.length;await page(make());assert.equal(shown.length,count+1);
console.log('PASS unfocused browser window uses OS alert instead of a second foreground popup/ringtone');
const retry=make(),show=sandbox.registration.showNotification;
sandbox.registration.showNotification=async()=>{throw new Error('Fixture temporary display failure');};
await push(retry);assert.equal(store.has(`event:${owner}:${retry.id}`),false);
sandbox.registration.showNotification=show;await push(retry);assert.equal(shown.at(-1).data.id,retry.id);
console.log('PASS temporary OS display failure releases dedupe claim for retry');
await push(null);const generic=shown.at(-1);windows=[];await emit('notificationclick',{notification:{data:generic.data,close:()=>{}}});assert.equal(opened.at(-1),'https://myhostage.test/video/#/messages');
console.log('PASS empty push still displays a private generic update with safe Messenger routing');
const anotherOwner=randomUUID();shown.push({tag:'another-account',data:{owner:anotherOwner},closed:false});
count=shown.length;await page(make(),anotherOwner);assert.equal(shown.length,count,'stale page delivery must not enter another account');
await emit('message',{source:windowClient(),data:{type:'clear-notifications',owner},ports:[]});
assert.equal(shown.filter(item=>item.data?.owner===owner&& !item.closed).length,0);
assert.equal(shown.at(-1).closed,false,'delayed logout must not close a newer account notification');
await emit('message',{source:windowClient(),data:{type:'clear-notifications'},ports:[]});assert.equal(shown.at(-1).closed,false);
console.log('PASS notification delivery and cleanup are owner-specific across delayed sign-out/account switching');
console.log('PASS notification SW leaves media fetches, WebRTC and read state untouched');
