import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium, firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const firefoxMode = process.env.BROWSER_TYPE === 'firefox';
const browser = await (firefoxMode ? firefox : chromium).launch({ headless: true, ...(firefoxMode ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5216';
await fs.mkdir('.runtime/call-layout', { recursive: true });
let checks = 0;
try {
  for (const [name, width, height, touch] of [['desktop',1440,900,false], ['tablet',768,1024,true], ['portrait',390,844,true], ['landscape',844,390,true]]) {
    const context = await browser.newContext({ viewport:{width,height}, hasTouch:touch, ...(!firefoxMode ? {isMobile:touch} : {}) });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const NativeAudio = window.AudioContext;
      window.__captures = []; window.__peers = []; window.__rings = 0; window.__stops = 0; window.__replaces = 0;
      window.__nativeRequests = 0; window.__rejectFullscreen = false; window.__fullscreen = null;
      window.__realFullscreen = {request:HTMLElement.prototype.requestFullscreen,exit:document.exitFullscreen,
        element:Object.getOwnPropertyDescriptor(Document.prototype,'fullscreenElement'),enabled:Object.getOwnPropertyDescriptor(Document.prototype,'fullscreenEnabled')};
      Object.defineProperty(document, 'fullscreenEnabled', {configurable:true,get:()=>true});
      Object.defineProperty(document, 'fullscreenElement', {configurable:true,get:()=>window.__fullscreen});
      HTMLElement.prototype.requestFullscreen = async function() {
        window.__nativeRequests++;
        if(window.__rejectFullscreen) throw new Error('Unsupported fullscreen');
        window.__fullscreen=this; document.dispatchEvent(new Event('fullscreenchange'));
      };
      document.exitFullscreen = async () => { window.__fullscreen=null; document.dispatchEvent(new Event('fullscreenchange')); };
      class ToneContext {
        state='running'; currentTime=0; destination={};
        constructor(){window.__toneContexts ||= [];window.__toneContexts.push(this);}
        resume(){this.state='running';return Promise.resolve();} close(){this.state='closed';return Promise.resolve();}
        createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
        createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){window.__rings++;},stop(){window.__stops++;}};}
      }
      window.AudioContext=ToneContext;
      const canvasStream = (local) => {
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
        const ctx=canvas.getContext('2d');ctx.fillStyle=local?'#2a6574':'#27496c';ctx.fillRect(0,0,960,540);
        ctx.fillStyle='#dfbf9b';ctx.beginPath();ctx.arc(480,220,78,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=local?'#9bc4ce':'#91b7dd';ctx.beginPath();ctx.ellipse(480,500,165,170,0,0,Math.PI*2);ctx.fill();
        const stream=canvas.captureStream(5);
        window.__canvases ||= [];window.__canvases.push(canvas);
        return stream;
      };
      const microphone = () => { const audio=new NativeAudio();const dest=audio.createMediaStreamDestination();window.__audio ||= [];window.__audio.push(audio);return dest.stream.getAudioTracks()[0]; };
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.__captures.push(constraints);
        const stream=constraints.video?canvasStream(true):new MediaStream();
        if(constraints.audio)stream.addTrack(microphone());return stream;
      };
      navigator.mediaDevices.enumerateDevices=async()=>[{deviceId:'mic',kind:'audioinput',label:'Fixture microphone'},{deviceId:'cam',kind:'videoinput',label:'Fixture camera'},{deviceId:'speaker',kind:'audiooutput',label:'Fixture speaker'}];
      const sender=track=>({track,replaceTrack:async function(next){this.track=next;window.__replaces++;},getParameters:()=>({encodings:[{}]}),setParameters:async()=>{}});
      class Peer {
        connectionState='connected';iceConnectionState='connected';signalingState='stable';transceivers=[];
        constructor(){window.__peers.push(this);}
        addTrack(track){const s=sender(track);this.transceivers.push({sender:s,receiver:{track:{kind:track.kind}}});return s;}
        addTransceiver(track){const s=sender(typeof track==='string'?null:track);this.transceivers.push({sender:s,receiver:{track:{kind:'video'}}});return s;}
        getSenders(){return this.transceivers.map(t=>t.sender);}getTransceivers(){return this.transceivers;}
        setConfiguration(){}close(){this.connectionState='closed';this.signalingState='closed';}restartIce(){throw new Error('Unexpected ICE restart');}
      }
      window.RTCPeerConnection=Peer;
      window.__attachRemote = () => {
        const stream=canvasStream(false);stream.addTrack(microphone());window.__remoteStream=stream;
        for(const track of stream.getTracks())window.__peers.at(-1).ontrack({track});
      };
      window.__mediaSnapshot=()=>({peers:window.__peers.length,captures:window.__captures.length,replaces:window.__replaces,trackIds:window.__peers.at(-1)?.getSenders().map(s=>s.track?.id)});
    });
    let call=null, invitation=null;
    const makeCall = (media, incoming=false) => ({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',conversation_id:'conversation',caller_id:incoming?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      caller_name:'Alex',name:'Alex',media,state:incoming?'ringing':'active',my_state:incoming?'invited':'joined',mine:!incoming,seen:false,started_at:new Date().toISOString(),answered_at:incoming?null:new Date(Date.now()-65000).toISOString(),ended_at:null,duration:0,outcome:null,
      members:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alex',state:'joined'},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'You',state:incoming?'invited':'joined'}]});
    await page.route('https://call-ui-test.supabase.co/**',route=>{
      const body=route.request().postDataJSON()||{};
      if(route.request().url().includes('/functions/v1/messenger-calls'))return route.fulfill({json:body.action==='configuration'?{configured:true,maxParticipants:4}:{iceServers:[],expiresAt:Date.now()+3600000}});
      let result=null;
      switch(body.p_action){
        case 'inbox':result=invitation?[invitation]:call?[call]:[];break;
        case 'start':call=makeCall(body.p_data.media);result=call;break;
        case 'heartbeat':result=call;break;
        case 'signals':result=[];break;
        case 'end':result={...call,state:'ended',my_state:'left'};call=null;break;
        case 'decline':result={...invitation,state:'ended',my_state:'declined'};invitation=null;break;
        case 'accept':call={...invitation,state:'active',my_state:'joined',answered_at:new Date().toISOString()};invitation=null;result=call;break;
      }
      return route.fulfill({json:result});
    });
    await page.goto(base+'/tests/messenger-call-ui.html');
    await page.getByRole('button',{name:'Video call',exact:true}).click();
    const panel=page.locator('.call-active');await panel.waitFor();
    await page.waitForFunction(()=>window.__peers.length===1);
    await page.evaluate(()=>window.__attachRemote());
    await page.waitForFunction(()=>document.querySelector('.call-remote video')?.videoWidth>0);
    assert.equal(await page.evaluate(()=>window.__captures[0].video!==false),true);
    const remote=page.locator('.call-remote video'), self=page.locator('.call-self-view');
    const before=await page.evaluate(()=>{window.__videoNode=document.querySelector('.call-remote video');return window.__mediaSnapshot();});
    const r=await remote.boundingBox(), s=await self.boundingBox();assert.ok(s.width<r.width*0.4&&s.height<r.height*0.6,'small PiP');
    assert.equal(await self.getAttribute('data-corner'),'top-right');
    assert.equal(await remote.evaluate(n=>getComputedStyle(n).objectFit),'contain');
    assert.equal(await remote.evaluate(n=>getComputedStyle(n).transform),'none');
    assert.ok((await self.locator('video').evaluate(n=>getComputedStyle(n).transform)).includes('-1'));
    if(name==='desktop')await panel.screenshot({path:'.runtime/call-layout/video-normal.png'});
    await page.getByRole('button',{name:'Expand call',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.call-fullscreen'));
    const full=await panel.boundingBox();assert.ok(Math.abs(full.x)<1&&Math.abs(full.y)<1&&Math.abs(full.width-width)<1&&Math.abs(full.height-height)<1,'whole viewport');
    assert.equal(await page.evaluate(()=>document.fullscreenElement?.classList.contains('call-active')),true,'container fullscreen, not video');
    for(let i=0;i<4;i++){
      const preview=await self.boundingBox(), controls=await page.locator('.call-footer').boundingBox(), header=await page.locator('.call-header').boundingBox();
      assert.ok(preview.x>=0&&preview.y>=header.y+header.height&&preview.x+preview.width<=width+1&&preview.y+preview.height<=controls.y+1,'PiP inside safe area and clear of controls');
      await self.getByRole('button',{name:'Move self-view to next corner'}).click();
    }
    await page.getByRole('button',{name:'Hide self-view',exact:true}).click();assert.equal(await self.count(),0);
    await page.getByRole('button',{name:'Show self-view',exact:true}).click();await self.waitFor();
    await page.getByRole('button',{name:'Devices',exact:true}).click();
    await page.getByRole('combobox',{name:'Microphone',exact:true}).waitFor();
    const preview=await self.boundingBox(),footer=await page.locator('.call-footer').boundingBox();assert.ok(preview.y+preview.height<=footer.y+1);
    await page.getByRole('button',{name:'Devices',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__mediaSnapshot()),before,'layout does not touch peers/tracks/media');
    assert.equal(await page.evaluate(()=>window.__videoNode===document.querySelector('.call-remote video')),true,'remote node retained');
    const dragFrom=await self.boundingBox();
    await page.mouse.move(dragFrom.x+dragFrom.width/2,dragFrom.y+dragFrom.height/2);await page.mouse.down();
    await page.mouse.move(12,height-5,{steps:5});await page.mouse.up();
    assert.equal(await self.getAttribute('data-corner'),'bottom-left','drag snaps to safe corner');
    await page.setViewportSize({width:height,height:width});
    await page.waitForFunction(()=>{const s=document.querySelector('.call-self-view').getBoundingClientRect(),f=document.querySelector('.call-footer').getBoundingClientRect();return s.right<=innerWidth&&s.bottom<=f.top+1;});
    await page.setViewportSize({width,height});
    await page.waitForFunction(()=>{const s=document.querySelector('.call-self-view').getBoundingClientRect(),f=document.querySelector('.call-footer').getBoundingClientRect();return s.right<=innerWidth&&s.bottom<=f.top+1;});
    await self.getByRole('button',{name:'Move self-view to next corner'}).click();
    await self.getByRole('button',{name:'Move self-view to next corner'}).click();
    if(name==='desktop')await panel.screenshot({path:'.runtime/call-layout/video-fullscreen.png'});
    await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.querySelector('.call-fullscreen'));
    await page.evaluate(()=>window.__rejectFullscreen=true);
    await page.getByRole('button',{name:'Expand call',exact:true}).click();await page.locator('.call-fullscreen').waitFor();
    assert.equal(await page.evaluate(()=>document.fullscreenElement),null,'CSS fallback after rejection');
    const fallback=await panel.boundingBox();assert.ok(Math.abs(fallback.width-width)<1&&Math.abs(fallback.height-height)<1);
    await page.keyboard.press('Escape');assert.ok(await page.locator('.call-fullscreen').isVisible(),'fallback retains task');
    const end=await page.getByRole('button',{name:'End call',exact:true}).boundingBox();assert.ok(end.y>=0&&end.y+end.height<=height,'hangup reachable');
    await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.call-fullscreen'));
    assert.deepEqual(await page.evaluate(()=>window.__mediaSnapshot()),before);
    if(name==='desktop'){
      await page.evaluate(()=>{
        const real=window.__realFullscreen;HTMLElement.prototype.requestFullscreen=real.request;document.exitFullscreen=real.exit;
        Object.defineProperty(document,'fullscreenElement',real.element);Object.defineProperty(document,'fullscreenEnabled',real.enabled);
      });
      await page.getByRole('button',{name:'Expand call',exact:true}).click();await page.locator('.call-fullscreen').waitFor();
      await page.waitForFunction(()=>!!document.fullscreenElement);
      assert.equal(await page.evaluate(()=>document.fullscreenElement===document.querySelector('.call-active')),true,'real browser API targets complete container');
      await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement&&!document.querySelector('.call-fullscreen'));
      assert.deepEqual(await page.evaluate(()=>window.__mediaSnapshot()),before,'real fullscreen leaves engine unchanged');
    }
    await page.getByRole('button',{name:'Camera off',exact:true}).click();await page.getByRole('button',{name:'Camera on',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__peers[0].getSenders().find(s=>s.track?.kind==='audio').track.readyState),'live');
    assert.ok(await panel.isVisible(),'camera off keeps call');
    await page.getByRole('button',{name:'End call',exact:true}).click();await panel.waitFor({state:'detached'});
    await page.getByRole('button',{name:'Voice call',exact:true}).click();await panel.waitFor();
    assert.equal(await page.evaluate(()=>window.__captures.at(-1).video),false,'voice capture microphone only');
    assert.equal(await page.locator('.call-stage,.call-self-view').count(),0,'voice has no video canvas');
    assert.equal(await page.getByRole('button',{name:'Camera off',exact:true}).count(),0);
    assert.ok(await page.locator('.call-voice-person').isVisible());
    if(name==='desktop')await panel.screenshot({path:'.runtime/call-layout/voice-normal.png'});
    await page.getByRole('button',{name:'Expand call',exact:true}).click();await page.locator('.call-fullscreen').waitFor();
    await page.waitForFunction(()=>{const r=document.querySelector('.call-fullscreen')?.getBoundingClientRect();return r&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1;});
    await page.getByRole('button',{name:'End call',exact:true}).click();await panel.waitFor({state:'detached'});
    await page.waitForFunction(()=>!document.fullscreenElement&&document.body.style.overflow==='');
    for(const media of ['voice','video']){
      if(media==='video')await page.evaluate(()=>{for(const audio of window.__toneContexts)audio.state='suspended';});
      const rings=await page.evaluate(()=>window.__rings);invitation=makeCall(media,true);
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('messenger-call')));
      const incoming=page.getByRole('dialog',{name:'Alex'});await incoming.waitFor();await incoming.getByText('Incoming '+media+' call',{exact:true}).waitFor();
      if(media==='video')await incoming.getByRole('button',{name:'Enable call sound',exact:true}).click();
      await page.waitForFunction(previous=>window.__rings>previous,rings);
      await incoming.getByRole('button',{name:'Mute ringing',exact:true}).click();
      const stopped=await page.evaluate(()=>window.__rings);await page.waitForTimeout(2900);assert.equal(await page.evaluate(()=>window.__rings),stopped);
      await incoming.getByRole('button',{name:'Unmute ringing',exact:true}).click();await page.waitForFunction(previous=>window.__rings>previous,stopped);
      await incoming.getByRole('button',{name:'Decline',exact:true}).click();await incoming.waitFor({state:'detached'});
      const declined=await page.evaluate(()=>window.__rings);await page.waitForTimeout(2900);assert.equal(await page.evaluate(()=>window.__rings),declined);
    }
    invitation=makeCall('video',true);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('messenger-call')));
    const accepted=page.getByRole('dialog',{name:'Alex'});await accepted.waitFor();await accepted.getByRole('button',{name:'Accept',exact:true}).click();
    await panel.waitFor();assert.ok(await page.evaluate(()=>!!window.__captures.at(-1).video&&!!window.__captures.at(-1).audio),'incoming video requests both media types');
    const acceptedRings=await page.evaluate(()=>window.__rings);await page.waitForTimeout(2900);assert.equal(await page.evaluate(()=>window.__rings),acceptedRings,'accept stops ringing');
    await page.getByRole('button',{name:'End call',exact:true}).click();await panel.waitFor({state:'detached'});
    assert.equal(await page.locator('[inert]').count(),0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
    assert.deepEqual(errors,[]);checks++;console.log('PASS '+name+': voice/video, safe PiP, native/fallback fullscreen, stable peers/media, ringtone cleanup');await context.close();
  }
}finally{await browser.close();}
console.log(checks+' responsive call layouts passed in '+(firefoxMode?'Firefox':'Chromium')+' (fixtures, not live network/media).');
