import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = (await readFile(new URL('../src/lib/callEngine.ts', import.meta.url), 'utf8')).replace(/^import .*;\r?$/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
class Track { constructor(kind) { this.kind=kind; this.id=String(Math.random()); this.readyState='live'; this.enabled=true; this.onended=null; } stop() { this.readyState='ended'; } }
class Stream { constructor(tracks=[]) { this.tracks=[...tracks]; } getTracks(){return [...this.tracks];} getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');} getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');} addTrack(t){this.tracks.push(t);} removeTrack(t){this.tracks=this.tracks.filter(x=>x!==t);} }
class Peer {
  constructor(configuration){this.configuration=configuration;this.senders=[];this.connectionState='new';this.signalingState='stable';this.iceConnectionState='new';}
  addTrack(t){this.addTransceiver(t);}
  addTransceiver(t){const kind=typeof t==='string'?t:t.kind; const sender={track:typeof t==='string'?null:t,replaceTrack:async t=>{sender.track=t;},getParameters:()=>({encodings:[{}]}),setParameters:async()=>{}}; this.senders.push({sender,receiver:{track:{kind}}});}
  getSenders(){return this.senders.map(x=>x.sender);} getTransceivers(){return this.senders;}
  setConfiguration(configuration){this.configuration=configuration;} restartIce(){this.restarts=(this.restarts||0)+1;} close(){this.connectionState='closed';this.signalingState='closed';}
}
let serverCall=null, failEnd=false, requests=[], streams=[], pendingMedia=null, mediaRequests=0, relayRequests=0, pendingDevices=null, failMediaState=false;
let timerId=0; const timers=new Map();
const browser=new EventTarget(); Object.assign(browser,{isSecureContext:true,RTCPeerConnection:Peer,setInterval:()=>1,clearInterval:()=>{},
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)});
const navigator={onLine:false,mediaDevices:{
  getUserMedia:async options=>{mediaRequests++;if(pendingMedia)return pendingMedia;const s=new Stream([...(options.audio?[new Track('audio')]:[]),...(options.video?[new Track('video')]:[])]);streams.push(s);return s;},
  getDisplayMedia:async()=>{const s=new Stream([new Track('video')]);streams.push(s);return s;}, enumerateDevices:async()=>pendingDevices||[]}};
const relay=async()=>{relayRequests++;return {iceServers:[{urls:'turn:fixture.invalid',username:'test',credential:'test'}],expiresAt:Date.now()+3600000};};
const call={id:'call',conversation_id:'conversation',caller_id:'a',media:'video',state:'ringing',my_state:'joined',members:[{id:'a',state:'joined'},{id:'b',state:'invited'}]};
const request=async(action,id,data)=>{requests.push({action,id,data});if(action==='media-state'&&failMediaState)throw Error('offline media');if(action==='start'){serverCall={...call,media:data.media};return serverCall;}if(action==='accept'){serverCall={...call,state:'active',members:call.members.map(m=>({...m,state:'joined'}))};return serverCall;}if(action==='inbox')return serverCall?[serverCall]:[];if(action==='signals')return [];if(action==='heartbeat')return serverCall;if(action==='end'){if(failEnd)throw Error('offline');serverCall={...serverCall,state:'ended',my_state:'left'};return serverCall;}return {};};
const exports={}; new Function('exports','chatRequestId','callRelay','callRequest','window','navigator','RTCPeerConnection','MediaStream','document',compiled)(exports,()=>String(Math.random()),relay,request,browser,navigator,Peer,Stream,browser);
const {CallEngine}=exports; let checks=0; const pass=label=>{checks++;console.log('PASS '+label);};
let engine=new CallEngine('a',()=>{});
await Promise.all([engine.start('conversation','video'),engine.start('conversation','video')]);
assert.equal(requests.filter(r=>r.action==='start').length,1); assert.equal(engine.state.local.getTracks().length,2);
pass('synchronous pending guard prevents duplicate starts and media acquisition');
serverCall={...serverCall,state:'active',members:call.members.map(m=>({...m,state:'joined'}))}; navigator.onLine=true; await engine.poll();
assert.equal(engine.state.remotes.length,1);
const connectionPeer=engine.peers.get('b');assert.equal(connectionPeer.pc.configuration.iceTransportPolicy,'all');
engine.relay.expiresAt=Date.now()+60000;await engine.poll();assert.ok(engine.relay.expiresAt>Date.now()+3590000);assert.equal(connectionPeer.pc.restarts||0,0);
pass('production ICE permits direct paths; refreshing relay credentials does not restart healthy media');
engine.mute();assert.equal(engine.state.local.getAudioTracks()[0].enabled,false);
const camera=engine.state.local.getVideoTracks()[0]; await engine.share();const screen=engine.state.local.getVideoTracks()[0];
assert.equal(engine.state.sharing,true);assert.notEqual(screen,camera); await engine.share();assert.equal(screen.readyState,'ended');assert.equal(engine.state.local.getVideoTracks()[0],camera);
await engine.camera();assert.equal(camera.readyState,'ended');assert.equal(engine.state.camera,false);await engine.camera();assert.equal(engine.state.camera,true);
const oldAudio=engine.state.local.getAudioTracks()[0];await engine.microphone('chosen');assert.equal(oldAudio.readyState,'ended');assert.equal(engine.state.local.getAudioTracks()[0].enabled,false);
assert.equal(engine.state.microphoneId,'chosen');
pass('mute, camera toggles, device replacement and screen restoration release old tracks');
// Test cleanup when replacement fails: the fresh camera must not leak capture.
const peer=engine.peers.get('b').pc;const videoSender=peer.getTransceivers().find(t=>t.receiver.track.kind==='video').sender;
const original=videoSender.replaceTrack; videoSender.replaceTrack=async()=>{throw Error('replace failed');};
const retained=engine.state.local.getVideoTracks()[0];await engine.camera('bad-device');assert.equal(streams.at(-1).getVideoTracks()[0].readyState,'ended');assert.equal(retained.readyState,'live');assert.notEqual(engine.state.cameraId,'bad-device');videoSender.replaceTrack=original;
pass('failed device replacement stops newly acquired capture and retains old camera');
failEnd=true;const captured=engine.state.local.getTracks();await Promise.all([engine.end(),engine.end()]);assert.ok(captured.every(t=>t.readyState==='ended'));assert.equal(engine.state.call,null);assert.equal(engine.state.microphoneId,'');assert.equal(engine.state.cameraId,'');assert.match(engine.state.error,/capture stopped/);
failEnd=false;await engine.poll();assert.equal(engine.ending,null);engine.dispose();
pass('end stops capture during network failure, prevents duplicate submission and retries');
navigator.onLine=false;engine=new CallEngine('a',()=>{});await engine.start('conversation','voice');const audio=engine.state.local.getAudioTracks()[0];
serverCall={...serverCall,state:'ended',my_state:'left'};navigator.onLine=true;await engine.poll();assert.equal(audio.readyState,'ended');assert.equal(engine.state.call,null);engine.dispose();
pass('remote hangup clears local capture through terminal heartbeat');
navigator.onLine=false;let release;pendingMedia=new Promise(resolve=>{release=resolve;});engine=new CallEngine('a',()=>{});const starting=engine.start('conversation','video');
await Promise.resolve();await Promise.resolve();engine.dispose();const delayed=new Stream([new Track('audio'),new Track('video')]);release(delayed);await starting;assert.ok(delayed.getTracks().every(t=>t.readyState==='ended'));
pass('signout during browser permission acquisition cannot leak media');
pendingMedia=null;timers.clear();
// Initial capture must be invoked inside the tap, before configuration requests.
let resolveCapture;pendingMedia=new Promise(resolve=>{resolveCapture=resolve;});
engine=new CallEngine('b',()=>{});const mediaBefore=mediaRequests,relayBefore=relayRequests,acceptBefore=requests.filter(r=>r.action==='accept').length;
const accepting=engine.accept({...call,my_state:'invited'});
assert.equal(engine.state.busy,true);assert.equal(mediaRequests,mediaBefore+1);assert.equal(relayRequests,relayBefore);
await engine.accept(call);assert.equal(mediaRequests,mediaBefore+1);
pendingDevices=new Promise(()=>{});
resolveCapture(new Stream([new Track('audio'),new Track('video')]));await accepting;
assert.equal(requests.filter(r=>r.action==='accept').length,acceptBefore+1);assert.equal(engine.state.busy,false);assert.equal(engine.state.call.state,'active');engine.dispose();
pendingDevices=null;pendingMedia=null;
pass('Accept requests permission synchronously, prevents double taps and never waits for optional device enumeration');
let resolveLate;pendingMedia=new Promise(resolve=>{resolveLate=resolve;});engine=new CallEngine('b',()=>{});
const beforeTimeout=requests.filter(r=>r.action==='accept').length;const waiting=engine.accept(call);
const timeout=[...timers.values()].find(t=>t.delay===25000);assert.ok(timeout);timeout.callback();await waiting;
assert.equal(engine.state.busy,false);assert.match(engine.state.error,/access did not complete/);assert.equal(engine.state.local,null);
assert.equal(requests.filter(r=>r.action==='accept').length,beforeTimeout);
const late=new Stream([new Track('audio'),new Track('video')]);resolveLate(late);await Promise.resolve();await Promise.resolve();
assert.ok(late.getTracks().every(t=>t.readyState==='ended'));engine.dispose();pendingMedia=null;timers.clear();
pass('stalled permission shows an actionable error, does not accept on the server and stops late capture');
navigator.onLine=false;engine=new CallEngine('a',()=>{});await engine.start('conversation','video');
serverCall={...serverCall,state:'active',members:call.members.map(m=>({...m,state:'joined'}))};navigator.onLine=true;await engine.poll();
const samePeer=engine.peers.get('b').pc, sameAudio=engine.state.local.getAudioTracks()[0];
const latestState=()=>requests.filter(r=>r.action==='media-state').at(-1).data;
assert.equal(latestState().cameraState,'enabled');
await engine.camera();await Promise.resolve();assert.equal(latestState().cameraState,'disabled');
assert.equal(latestState().screenSharing,false);assert.equal(engine.peers.get('b').pc,samePeer);assert.equal(sameAudio.readyState,'live');
await engine.camera();await Promise.resolve();assert.equal(latestState().cameraState,'enabled');
await engine.receive({id:100,sender_id:'b',kind:'media-state',payload:{cameraState:'disabled',screenSharing:false,revision:7}});
assert.equal(engine.state.remotes[0].mediaState.cameraState,'disabled');
await engine.receive({id:101,sender_id:'b',kind:'media-state',payload:{cameraState:'enabled',screenSharing:false,revision:6}});
assert.equal(engine.state.remotes[0].mediaState.cameraState,'disabled','stale event cannot undo camera off');
serverCall={...serverCall,members:serverCall.members.map(m=>({...m,mediaState:{cameraState:'enabled',screenSharing:false,revision:2}}))};
await engine.poll();assert.equal(engine.state.remotes[0].mediaState.revision,7,'stale inbox cannot override a signal');
await engine.receive({id:102,sender_id:'b',kind:'media-state',payload:{cameraState:'enabled',screenSharing:false,revision:8}});
assert.equal(engine.state.remotes[0].mediaState.cameraState,'enabled');assert.equal(engine.peers.get('b').pc,samePeer);
await engine.share();await engine.camera();await Promise.resolve();
assert.equal(latestState().cameraState,'disabled');assert.equal(latestState().screenSharing,true,'camera off does not suppress shared screen');
await engine.share();await Promise.resolve();assert.equal(latestState().screenSharing,false);assert.equal(latestState().cameraState,'disabled');
await engine.camera();const disconnected=engine.state.local.getVideoTracks()[0];disconnected.readyState='ended';disconnected.onended();
await Promise.resolve();await Promise.resolve();assert.equal(engine.state.camera,false);assert.equal(latestState().cameraState,'disabled');
assert.equal(engine.peers.get('b').pc,samePeer);assert.equal(sameAudio.readyState,'live');
failMediaState=true;await engine.camera();await Promise.resolve();assert.match(engine.state.error,/synchronized/);
await engine.camera();await Promise.resolve();assert.equal(engine.pendingMediaState.payload.cameraState,'disabled');
const retryRevision=engine.pendingMediaState.payload.revision;
failMediaState=false;await engine.poll();await Promise.resolve();await Promise.resolve();assert.equal(engine.pendingMediaState,null);
assert.equal(latestState().revision,retryRevision);assert.equal(latestState().cameraState,'disabled');
assert.equal(engine.peers.get('b').pc,samePeer);assert.equal(sameAudio.readyState,'live');
await engine.end();engine.dispose();
pass('camera state signals are versioned, honor actual capture, preserve screen/audio and reuse peer connections');
navigator.onLine=false;engine=new CallEngine('a',()=>{});await engine.start('conversation','video');
serverCall={...serverCall,state:'active',members:call.members.map(m=>({...m,state:'joined',mediaState:m.id==='b'?{cameraState:'disabled',screenSharing:false,revision:12}:null}))};
navigator.onLine=true;await engine.poll();assert.equal(engine.state.remotes[0].mediaState.cameraState,'disabled');assert.equal(engine.state.remotes[0].mediaState.revision,12);
await engine.end();engine.dispose();
pass('new peer starts with persisted camera state for late joiners');
console.log(`${checks} call engine checks passed.`);
