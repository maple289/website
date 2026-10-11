import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile('src/lib/callAudioOutput.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const { CallAudioOutput, isMobileAudioDevice, outputKind } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
let checks=0;
const device=(deviceId,label,kind='audiooutput')=>({deviceId,label,kind,groupId:deviceId+'-group'});
const phone=[device('random-receiver','Earpiece'),device('random-speaker','Built-in speaker'),device('default-alias','Default'),device('mic','Built-in microphone','audioinput')];
function fixture({mobile=true,supported=true,devices=phone,picker=true}={}) {
  const media=new EventTarget(), windowEvents=new EventTarget(), documentEvents=new EventTarget();
  const selected=[],elements=[];
  let outputs=devices,pick=phone[0];
  class Element {
    sinkId=''; fail=null; mismatch=false; delay=0;
    constructor(){elements.push(this);if(!supported){this.setSinkId=undefined;this.sinkId=undefined;}}
    async setSinkId(id){selected.push({node:this,id});if(this.delay)await new Promise(resolve=>setTimeout(resolve,this.delay));if(this.fail?.(id))throw new DOMException('Denied','NotAllowedError');if(!this.mismatch)this.sinkId=id;}
  }
  media.enumerateDevices=async()=>outputs;
  if(picker)media.selectAudioOutput=async()=>{if(pick instanceof Error)throw pick;return pick;};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:mobile?'Mozilla Android Mobile':'Mozilla Windows',platform:mobile?'Linux armv8':'Win32',maxTouchPoints:mobile?5:0,mediaDevices:media}});
  globalThis.window=Object.assign(windowEvents,{isSecureContext:true,setTimeout,clearTimeout});
  globalThis.document=Object.assign(documentEvents,{hidden:false,createElement:()=>new Element()});
  return {Element,selected,elements,media,setDevices:next=>{outputs=next;media.dispatchEvent(new Event('devicechange'));},setPicker:next=>{pick=next;}};
}
const until=async(test)=>{for(let i=0;i<100&&!test();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(test(),'asynchronous routing settled');};
const pass=label=>{checks++;console.log('PASS '+label);};

assert.equal(isMobileAudioDevice({userAgent:'Windows',platform:'Win32',maxTouchPoints:5}),false);
assert.equal(isMobileAudioDevice({userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}),true);
assert.equal(isMobileAudioDevice({userAgent:'X',platform:'X',maxTouchPoints:0,userAgentData:{mobile:true}}),true);
assert.equal(outputKind({label:'Bluetooth speaker'}),'external');assert.equal(outputKind({label:'Default - Earpiece'}),'system');
assert.equal(outputKind({label:'Unknown output'}),'unknown');pass('mobile identity and conservative output labels, without screen-size/device-ID assumptions');

for(const callType of ['voice','video']){
  const f=fixture(),r=new CallAudioOutput(callType),node=new f.Element();const binding=r.register(node);await binding.ready;
  const id=callType==='voice'?'random-receiver':'random-speaker';assert.equal(node.sinkId,id);assert.equal(r.getSnapshot().sinkId,id);
  assert.equal(r.getSnapshot().kind,callType==='voice'?'receiver':'speaker');
  await r.toggleSpeaker();assert.equal(node.sinkId,callType==='voice'?'random-speaker':'random-receiver');
  await r.toggleSpeaker();assert.equal(node.sinkId,id);
  const late=new f.Element(),lateBinding=r.register(late);await lateBinding.ready;assert.equal(late.sinkId,id,'late participant inherits chosen output');
  binding.release();lateBinding.release();r.stop();pass(callType+' default, confirmed toggle and late-participant consistency');
}

for(const label of ['Bluetooth headset','Wired headphones','USB audio device','Unknown audio device']){
  const f=fixture({devices:[...phone,device('accessory',label)]}),r=new CallAudioOutput('video');await r.start();assert.equal(f.selected.length,0);assert.equal(r.getSnapshot().kind,'system');r.stop();
}pass('Bluetooth/wired/USB/unclassified outputs preserve the system route');
{
  for(const label of ['Bluetooth microphone','Opaque microphone']){
    const f=fixture({devices:[...phone,device('bt-mic',label,'audioinput')]}),r=new CallAudioOutput('voice');await r.start();
    assert.equal(f.selected.length,0);r.stop();
  }pass('known or opaque headset input protects OS routing even when its output is not enumerated');
}

{
  const f=fixture({mobile:false}),r=new CallAudioOutput('voice'),node=new f.Element();await r.register(node).ready;assert.equal(f.selected.length,0);
  await r.select('random-speaker');assert.equal(node.sinkId,'random-speaker');r.stop();pass('desktop default unchanged; explicit output selection remains available');
}
{
  const f=fixture({supported:false}),r=new CallAudioOutput('video'),node=new f.Element();await r.register(node).ready;await r.toggleSpeaker();await r.choose();
  assert.equal(f.selected.length,0);assert.equal(r.getSnapshot().supported,false);assert.equal(r.getSnapshot().kind,'system');r.stop();pass('unsupported routing leaves system audio intact');
}
{
  const f=fixture(),r=new CallAudioOutput('voice'),a=new f.Element(),b=new f.Element();await r.register(a).ready;await r.register(b).ready;
  b.fail=id=>id==='random-speaker';await r.toggleSpeaker();assert.equal(a.sinkId,'random-receiver');assert.equal(b.sinkId,'random-receiver');
  assert.equal(r.getSnapshot().kind,'receiver');assert.match(r.getSnapshot().error,/could not be confirmed/);r.stop();pass('partial group switch rejects optimistic state and rolls back successful nodes');
}
{
  const f=fixture(),r=new CallAudioOutput('voice'),node=new f.Element();await r.register(node).ready;node.mismatch=true;await r.toggleSpeaker();
  assert.equal(r.getSnapshot().kind,'receiver');assert.match(r.getSnapshot().error,/could not be confirmed/);r.stop();pass('resolved API promise without matching sinkId never claims a successful switch');
}
{
  const f=fixture(),r=new CallAudioOutput('video'),node=new f.Element();await r.register(node).ready;
  f.setDevices([...phone,device('bt','Bluetooth headset')]);await until(()=>r.getSnapshot().sinkId==='');assert.equal(node.sinkId,'');
  f.setDevices(phone);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(node.sinkId,'','no repeated automatic preference after headset disconnect');
  await r.select('random-receiver');f.setDevices([...phone,device('bt','Bluetooth headset')]);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(node.sinkId,'random-receiver','explicit user choice persists');
  f.setDevices([phone[1]]);await until(()=>r.getSnapshot().sinkId==='');assert.equal(node.sinkId,'');r.stop();pass('accessory connection restores OS routing for automatic defaults; chosen route persists until unavailable');
}
{
  const f=fixture({devices:[device('opaque','Unnamed output')]}),r=new CallAudioOutput('voice'),node=new f.Element();await r.register(node).ready;
  f.setPicker(device('granted-bt','Bluetooth headphones'));await r.choose();assert.equal(node.sinkId,'granted-bt');assert.equal(r.getSnapshot().kind,'external');
  f.setPicker(new DOMException('Cancel','NotAllowedError'));await r.choose();assert.equal(node.sinkId,'granted-bt');assert.match(r.getSnapshot().error,/No audio output/);r.stop();pass('permission picker grants dynamic output; cancellation preserves the route');
}
{
  const f=fixture(),r=new CallAudioOutput('voice'),node=new f.Element();await r.register(node).ready;node.delay=20;
  const first=r.toggleSpeaker(),second=r.toggleSpeaker();await Promise.all([first,second]);assert.equal(node.sinkId,'random-speaker');
  assert.equal(f.selected.filter(x=>x.node===node&&x.id==='random-speaker').length,1);r.stop();pass('synchronous guard prevents repeated pending switches');
}
{
  const f=fixture(),r=new CallAudioOutput('voice'),node=new f.Element();await r.register(node).ready;
  window.setTimeout=(callback,ms)=>setTimeout(callback,ms===3000?5:ms);node.delay=40;
  await r.toggleSpeaker();assert.notEqual(r.getSnapshot().kind,'speaker','timed-out selection is not successful');
  await until(()=>f.selected.some(x=>x.node===node&&x.id==='random-speaker')&&node.sinkId==='random-speaker');
  await until(()=>node.sinkId==='random-receiver'&&!r.getSnapshot().pending);
  assert.equal(r.getSnapshot().kind,'receiver');assert.equal(f.selected.filter(x=>x.node===node&&x.id==='random-speaker').length,1);r.stop();
  pass('late browser completion restores the current choice without overlapping output requests');
}
{
  const f=fixture(),r=new CallAudioOutput('video'),node=new f.Element();await r.register(node).ready;node.fail=id=>id==='';
  f.setDevices([phone[0]]);await until(()=>!!r.getSnapshot().error);const count=f.selected.filter(x=>x.node===node&&x.id==='').length;
  f.setDevices([phone[0]]);window.dispatchEvent(new Event('focus'));await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(f.selected.filter(x=>x.node===node&&x.id==='').length,count);assert.equal(r.getSnapshot().kind,'unknown');r.stop();
  pass('rejected device-loss fallback does not repeatedly retry on focus/devicechange');
}
{
  const f=fixture(),r=new CallAudioOutput('video');f.elements[0].fail=id=>id==='random-speaker';await r.start();
  assert.equal(r.getSnapshot().kind,'system');const count=f.selected.length;f.setDevices(phone);await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.selected.length,count);r.stop();pass('denied automatic preference remains on system audio without automatic retries');
}
{
  const f=fixture();let finish;f.media.enumerateDevices=()=>new Promise(resolve=>{finish=resolve;});
  const r=new CallAudioOutput('voice');void r.start();f.setPicker(device('new-grant','Bluetooth headphones'));const chosen=r.choose();
  await new Promise(resolve=>setTimeout(resolve,0));finish(phone);await chosen;
  assert.equal(r.getSnapshot().kind,'external');assert.equal(r.getSnapshot().label,'Bluetooth headphones');r.stop();
  pass('picker metadata survives an enumeration that started before permission was granted');
}
console.log(checks+' audio output policy checks passed (simulated browser outputs, not phone hardware).');
