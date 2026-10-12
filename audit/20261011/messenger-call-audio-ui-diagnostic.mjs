import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium,firefox}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const firefoxMode=process.env.BROWSER_TYPE==='firefox';
const browser=await (firefoxMode?firefox:chromium).launch({headless:true,...(firefoxMode?{}:{channel:process.env.BROWSER_CHANNEL||'msedge'})});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5216';
await fs.mkdir('.runtime/call-audio',{recursive:true});
let checks=0;
try{
  for(const scenario of [
    {name:'voice-outgoing',media:'voice'}, {name:'video-outgoing',media:'video'},
    {name:'voice-incoming',media:'voice',incoming:true}, {name:'video-incoming',media:'video',incoming:true},
    {name:'bluetooth',media:'video',accessory:'Bluetooth headset'},
    {name:'wired',media:'voice',accessory:'Wired headphones'},
    {name:'usb',media:'video',accessory:'USB audio device'},
    {name:'iphone-unsupported',media:'video',unsupported:true},
    {name:'android-unsupported',media:'voice',unsupported:true},
    {name:'desktop',media:'voice',desktop:true},
  ]){
    const context=await browser.newContext({viewport:scenario.desktop?{width:1440,height:900}:{width:390,height:844},hasTouch:!scenario.desktop,
      ...(!firefoxMode?{isMobile:!scenario.desktop}:{}),
      ...(!scenario.desktop?{userAgent:scenario.name.startsWith('iphone')?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile Safari/604.1':'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'}:{})});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(scenario=>{
      window.__caps={sink:typeof HTMLMediaElement.prototype.setSinkId==='function',picker:typeof navigator.mediaDevices.selectAudioOutput==='function'};
      window.__sinkRequests=[];window.__sinks=new WeakMap();window.__failSink=null;window.__sinkDelay=0;window.__peers=[];window.__captures=[];
      HTMLElement.prototype.requestFullscreen=async()=>{throw new Error('Test CSS fullscreen fallback');};
      const device=(label,kind='audiooutput')=>({deviceId:crypto.randomUUID(),groupId:crypto.randomUUID(),label,kind});
      window.__receiver=device('Earpiece');window.__speaker=device('Built-in speaker');window.__headset=device('Bluetooth headset');
      window.__outputs=[window.__receiver,window.__speaker,device('Built-in microphone','audioinput')];
      if(scenario.accessory)window.__outputs.push(device(scenario.accessory));
      navigator.mediaDevices.enumerateDevices=async()=>window.__outputs;
      if(scenario.unsupported)Object.defineProperty(HTMLMediaElement.prototype,'setSinkId',{configurable:true,value:undefined});
      else{
        Object.defineProperty(HTMLMediaElement.prototype,'sinkId',{configurable:true,get(){return window.__sinks.get(this)||'';}});
        Object.defineProperty(HTMLMediaElement.prototype,'setSinkId',{configurable:true,value:async function(id){
          window.__sinkRequests.push({id,element:this});if(window.__sinkDelay)await new Promise(resolve=>setTimeout(resolve,window.__sinkDelay));
          if(id===window.__failSink)throw new DOMException('Denied','NotAllowedError');window.__sinks.set(this,id);
        }});
        navigator.mediaDevices.selectAudioOutput=async()=>{window.__pickerActivated=navigator.userActivation?.isActive;return window.__headset;};
      }
      const NativeAudio=window.AudioContext;
      navigator.mediaDevices.getUserMedia=async constraints=>{
        window.__captures.push(constraints);const audio=new NativeAudio(),stream=audio.createMediaStreamDestination().stream;
        window.__audio ||= [];window.__audio.push(audio);
        if(constraints.video){const c=document.createElement('canvas');c.width=320;c.height=240;c.getContext('2d').fillRect(0,0,320,240);const video=c.captureStream(5);stream.addTrack(video.getVideoTracks()[0]);window.__canvas=c;}
        return stream;
      };
      const sender=track=>({track,replaceTrack:async function(next){this.track=next;},getParameters:()=>({encodings:[{}]}),setParameters:async()=>{}});
      class Peer{
        connectionState='connected';signalingState='stable';iceConnectionState='connected';senders=[];
        constructor(){window.__peers.push(this);}addTrack(track){const s=sender(track);this.senders.push({sender:s,receiver:{track:{kind:track.kind}}});return s;}
        addTransceiver(track){return this.addTrack(track);}getSenders(){return this.senders.map(t=>t.sender);}getTransceivers(){return this.senders;}
        setConfiguration(){}close(){this.connectionState='closed';}restartIce(){throw new Error('Unexpected ICE restart');}
      }
      window.RTCPeerConnection=Peer;
      window.__remote=()=>{const audio=new NativeAudio();window.__audio.push(audio);const track=audio.createMediaStreamDestination().stream.getAudioTracks()[0];window.__remoteTrack=track;window.__peers.at(-1).ontrack({track});};
      window.__snapshot=()=>({peers:window.__peers.length,captures:window.__captures.length,tracks:window.__peers.at(-1).getSenders().map(s=>s.track.id)});
    },scenario);
    let call=null,invitation=null;
    const makeCall=incoming=>({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',conversation_id:'conversation',caller_id:incoming?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',caller_name:'Alex',name:'Alex',media:scenario.media,
      state:incoming?'ringing':'active',my_state:incoming?'invited':'joined',mine:!incoming,seen:false,started_at:new Date().toISOString(),answered_at:incoming?null:new Date().toISOString(),ended_at:null,duration:0,outcome:null,
      members:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alex',state:'joined'},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'You',state:incoming?'invited':'joined'}]});
    await page.route('https://audit-fixture.supabase.invalid/**',route=>{
      const body=route.request().postDataJSON()||{};if(route.request().url().includes('/functions/v1/messenger-calls'))return route.fulfill({json:body.action==='configuration'?{configured:true,maxParticipants:4}:{iceServers:[],expiresAt:Date.now()+3600000}});
      let result=null;switch(body.p_action){
        case'inbox':result=invitation?[invitation]:call?[call]:[];break;
        case'start':call=makeCall(false);result=call;break;
        case'accept':call={...invitation,state:'active',my_state:'joined'};invitation=null;result=call;break;
        case'heartbeat':result=call;break;case'signals':result=[];break;case'media-state':result={};break;
        case'end':result={...call,state:'ended',my_state:'left'};call=null;break;
      }return route.fulfill({json:result});
    });
    await page.goto(base+'/tests/messenger-call-ui.html');
    if(scenario.incoming){invitation=makeCall(true);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('messenger-call')));await page.getByRole('dialog',{name:'Alex'}).getByRole('button',{name:'Accept',exact:true}).click();}
    else await page.getByRole('button',{name:scenario.media==='voice'?'Voice call':'Video call',exact:true}).click();
    const panel=page.locator('.call-active');await panel.waitFor();await page.waitForFunction(()=>window.__peers.length===1);
    await page.evaluate(()=>window.__remote());const before=await page.evaluate(()=>window.__snapshot());
    const remote=page.locator('.call-remote video,.call-voice-stage video').first();await remote.waitFor({state:'attached'});
    const speaker=panel.getByRole('button',{name:'Speaker',exact:true});
    const id=await page.evaluate(media=>media==='voice'?window.__receiver.deviceId:window.__speaker.deviceId,scenario.media);
    if(scenario.unsupported||scenario.accessory||scenario.desktop){
      await page.waitForTimeout(200);assert.equal(await remote.evaluate(node=>node.sinkId||''),'');
      assert.equal(await page.evaluate(()=>window.__sinkRequests.length),0,'no automatic override of system/headset/desktop routing');
    }else{
      await page.waitForFunction(id=>[...document.querySelectorAll('.call-remote video,.call-voice-stage video')].every(node=>node.sinkId===id),id);
      await page.waitForFunction(()=>!document.querySelector('button[aria-label="Speaker"]')?.disabled);
      assert.equal(await speaker.getAttribute('aria-pressed'),String(scenario.media==='video'));
      await speaker.click();await page.waitForFunction(id=>document.querySelector('.call-remote video,.call-voice-stage video').sinkId!==id,id);
      await page.waitForFunction(()=>!document.querySelector('button[aria-label="Speaker"]').disabled);
      assert.equal(await speaker.getAttribute('aria-pressed'),String(scenario.media!=='video'));
      // Rotation and fullscreen leave the chosen route and media unchanged.
      const chosen=await remote.evaluate(node=>node.sinkId);
      await page.getByRole('button',{name:'Expand call',exact:true}).click();await page.locator('.call-fullscreen').waitFor();
      await page.setViewportSize({width:667,height:280});await page.waitForFunction(()=>document.querySelector('.call-active').getBoundingClientRect().width===innerWidth);
      assert.equal(await remote.evaluate(node=>node.sinkId),chosen);
      const box=await speaker.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=667&&box.y+box.height<=280,'Speaker stays on screen');
      await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
      if(scenario.name==='voice-outgoing'){
        await speaker.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Speaker"]').getAttribute('aria-pressed')==='false');
        await page.evaluate(()=>window.__failSink=window.__speaker.deviceId);await speaker.click();
        await page.waitForFunction(()=>!document.querySelector('[aria-label="Speaker"]').disabled);
        assert.equal(await speaker.getAttribute('aria-pressed'),'false','failed selection keeps confirmed receiver state');
        await page.evaluate(()=>{window.__failSink=null;window.__sinkDelay=150;});await speaker.click();
        assert.equal(await speaker.getAttribute('aria-pressed'),null,'pending output is not shown as switched');
        await page.waitForFunction(()=>document.querySelector('[aria-label="Speaker"]').getAttribute('aria-pressed')==='true');
        await page.evaluate(()=>{window.__sinkDelay=0;window.__outputs.push(window.__headset);navigator.mediaDevices.dispatchEvent(new Event('devicechange'));});
        await page.waitForTimeout(100);assert.notEqual(await remote.evaluate(node=>node.sinkId),'','explicit route choice persists on device change');
      }
    }
    if(scenario.desktop){assert.equal(await speaker.count(),0);}
    else if(scenario.unsupported){
      assert.equal(await speaker.getAttribute('aria-pressed'),null);await speaker.click();
      await page.getByText('Your phone controls the audio route.',{exact:false}).waitFor();
      assert.equal(await panel.getByRole('combobox',{name:'Audio output',exact:true}).count(),0);
    }
    if(!scenario.unsupported){
      await panel.getByRole('button',{name:'Devices',exact:true}).click();
      const options=panel.getByRole('combobox',{name:'Audio output',exact:true});await options.waitFor();
      // The native picker runs directly from a gesture and returns a granted, opaque ID.
      await panel.getByRole('button',{name:'Choose audio output',exact:true}).click();
      const headsetId=await page.evaluate(()=>window.__headset.deviceId);await page.waitForFunction(id=>document.querySelector('.call-remote video,.call-voice-stage video').sinkId===id,headsetId);
      assert.equal(await options.inputValue(),headsetId);
      if(!scenario.desktop)assert.equal(await speaker.getAttribute('aria-pressed'),null,'headset is not represented as earpiece');
      assert.equal(await page.evaluate(()=>window.__pickerActivated),true,'picker retains transient activation');
    }
    assert.deepEqual(await page.evaluate(()=>window.__snapshot()),before,'output controls never recreate peers/capture/tracks');
    assert.equal(await page.evaluate(()=>window.__remoteTrack.readyState),'live','audio remains connected');
    await panel.getByRole('button',{name:'End call',exact:true}).click();await panel.waitFor({state:'detached'});
    assert.deepEqual(errors,[]);checks++;console.log('PASS '+scenario.name+': confirmed routing/fallback; stable media and peers');await context.close();
  }
}finally{await browser.close();}
console.log(checks+' call audio UI scenarios passed in '+(firefoxMode?'Firefox':process.env.BROWSER_CHANNEL||'Edge')+' (output API fixtures; not real phone routes).');

