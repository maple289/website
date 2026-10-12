import { chatRequestId } from '@/lib/messenger';
import { callRelay, callRequest, type CallInfo, type CallSignal, type CallMediaState, type RelayConfig } from '@/lib/calls';

export type CallState = { call: CallInfo | null; inbox: CallInfo[]; local: MediaStream | null;
  remotes: { id: string; stream: MediaStream; connected: boolean; mediaState?: CallMediaState | null }[]; busy: boolean; error: string;
  muted: boolean; camera: boolean; sharing: boolean; devices: MediaDeviceInfo[]; microphoneId?: string; cameraId?: string };
export const emptyCallState: CallState = { call: null, inbox: [], local: null, remotes: [], busy: false,
  error: '', muted: false, camera: false, sharing: false, devices: [] };
type Peer = { pc: RTCPeerConnection; stream: MediaStream; makingOffer: boolean; ignoreOffer: boolean;
  settingAnswer: boolean; candidates: RTCIceCandidateInit[]; chain: Promise<void>; lastRestart: number; mediaState: CallMediaState | null };
const friendly = (cause: unknown) => cause instanceof DOMException
  ? cause.name === 'NotAllowedError' ? 'Microphone/camera permission was denied. Allow access in your browser to call.'
    : cause.name === 'NotFoundError' ? 'No suitable microphone or camera was found.'
      : cause.name === 'NotReadableError' ? 'Your microphone or camera is in use or unavailable.' : 'The media device could not be opened.'
  : cause instanceof Error ? cause.message : 'The call could not be completed.';

// One engine per signed-in account. Route changes never recreate this engine.
export class CallEngine {
  readonly sessionId = chatRequestId();
  state: CallState = { ...emptyCallState };
  private peers = new Map<string, Peer>();
  private cameraTrack: MediaStreamTrack | null = null;
  private screen: MediaStream | null = null;
  private relay: RelayConfig | null = null;
  private cursor = 0;
  private alive = true;
  private generation = 0;
  private polling = false;
  private pollAgain = false;
  private lastInbox = 0;
  private lastHeartbeat = 0;
  private timer: number;
  private ending: string | null = null;
  private endingRequest = false;
  private mediaRevision = 0;
  private pendingMediaState: { call: string; payload: CallMediaState } | null = null;
  private publishingMediaState = false;
  private event = (event: Event) => {
    if (!(event instanceof CustomEvent) || event.detail !== 'call-signal') { this.lastInbox = 0; this.lastHeartbeat = 0; }
    void this.poll();
  };
  constructor(private userId: string, private publish: (state: CallState) => void) {
    this.timer = window.setInterval(() => void this.poll(), 1500);
    window.addEventListener('messenger-call', this.event);
    window.addEventListener('online', this.event);
    window.addEventListener('pageshow', this.event);
    document.addEventListener('visibilitychange', this.event);
    void this.poll();
  }
  private update(patch: Partial<CallState>) { if (this.alive) { this.state = { ...this.state, ...patch }; this.publish(this.state); } }
  private ownData(extra: Record<string, unknown> = {}) { return { session_id: this.sessionId, ...extra }; }
  private remoteState() { this.update({ remotes: [...this.peers].map(([id, p]) => ({ id, stream: p.stream, connected: p.pc.connectionState === 'connected', mediaState: p.mediaState })) }); }
  private queueMediaState() {
    const call = this.state.call;
    if (!this.alive || call?.media !== 'video') return;
    const camera = this.cameraTrack;
    const screen = this.screen?.getVideoTracks()[0];
    this.pendingMediaState = { call: call.id, payload: { cameraState: camera?.enabled && !camera.muted && camera.readyState === 'live' ? 'enabled' : 'disabled',
      screenSharing: !!screen?.enabled && !screen.muted && screen.readyState === 'live', revision: ++this.mediaRevision } };
    void this.flushMediaState();
  }
  private async flushMediaState() {
    if (!this.alive || this.publishingMediaState) return;
    this.publishingMediaState = true;
    try {
      while (this.pendingMediaState && this.pendingMediaState.call === this.state.call?.id) {
        const pending = this.pendingMediaState;
        try {
          await callRequest('media-state', pending.call, this.ownData(pending.payload));
          if (this.pendingMediaState === pending) this.pendingMediaState = null;
          if (this.state.error === 'Camera state could not be synchronized. Retrying…') this.update({ error: '' });
        } catch {
          if (this.state.call?.id === pending.call) this.update({ error: 'Camera state could not be synchronized. Retrying…' });
          return; // Keep the latest state and retry during the next poll.
        }
      }
    } finally { this.publishingMediaState = false; }
  }
  private watchCamera(track: MediaStreamTrack) {
    track.onmute = track.onunmute = () => { if (this.cameraTrack === track) this.queueMediaState(); };
    track.onended = () => {
      if (this.cameraTrack !== track || !this.alive) return;
      this.cameraTrack = null; this.update({ camera: false }); this.queueMediaState();
      if (!this.screen) void this.replace('video', null).catch(() => this.update({ error: 'Camera disconnected. Toggle the camera to reconnect video.' }));
    };
  }
  private stopCamera(track: MediaStreamTrack | null) {
    if (!track) return;
    track.onended = track.onmute = track.onunmute = null; track.stop();
  }
  private supported() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error('Calling needs HTTPS and a browser with WebRTC support.');
  }
  private async media(video: boolean) {
    if (!this.alive) throw new Error('You are no longer signed in.');
    this.supported();
    // Request capture in the original button gesture, before any network await.
    // This is particularly important for browsers using WebKit on iOS.
    const capture = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true },
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } : false });
    const stream = await new Promise<MediaStream>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        settled = true;
        reject(new Error('Microphone/camera access did not complete. Check your browser and device permissions, then try again.'));
      }, 25000);
      void capture.then(value => {
        if (settled) { value.getTracks().forEach(track => track.stop()); return; }
        settled = true; window.clearTimeout(timeout); resolve(value);
      }, cause => {
        if (settled) return;
        settled = true; window.clearTimeout(timeout); reject(cause);
      });
    });
    if (!this.alive) { stream.getTracks().forEach(t => t.stop()); throw new Error('You are no longer signed in.'); }
    this.cameraTrack = stream.getVideoTracks()[0] ?? null;
    if (this.cameraTrack) this.watchCamera(this.cameraTrack);
    this.update({ local: stream, camera: !!this.cameraTrack, muted: false,
      microphoneId: stream.getAudioTracks()[0]?.getSettings?.().deviceId ?? '', cameraId: this.cameraTrack?.getSettings?.().deviceId ?? '' });
    // Device labels are optional; a slow enumerateDevices must not block Accept.
    void this.devices();
  }
  async devices() { try { this.update({ devices: await navigator.mediaDevices.enumerateDevices() }); } catch { /* optional browser support */ } }
  clearError() { if (!this.ending && !this.state.busy) this.update({ error: '' }); }
  async start(conversation: string, media: 'voice' | 'video') {
    if (!this.alive || this.state.busy || this.state.call || this.ending) return;
    this.update({ busy: true, error: '' });
    try {
      await this.media(media === 'video');
      await callRelay(); // Do not ring recipients if TURN has not been configured.
      if (!this.alive) return;
      const data = this.ownData({ conversation_id: conversation, media, client_id: chatRequestId() });
      const call = await this.retry<CallInfo>('start', null, data);
      if (!this.alive) { await callRequest('end', call.id, this.ownData()).catch(() => undefined); return; }
      this.update({ call }); this.cursor = 0; this.generation++;
      this.queueMediaState();
      this.relay = await callRelay(call.id, this.sessionId);
      await this.syncPeers(); this.lastInbox = 0;
    } catch (cause) { if (this.state.call) await this.end(); else this.releaseMedia(); this.update({ error: friendly(cause) }); }
    finally { this.update({ busy: false }); void this.poll(); }
  }
  async accept(call: CallInfo) {
    if (!this.alive || this.state.busy || this.state.call || this.ending) return;
    this.update({ busy: true, error: '' });
    try {
      await this.media(call.media === 'video'); await callRelay();
      if (!this.alive) return;
      const accepted = await this.retry<CallInfo>('accept', call.id, this.ownData());
      if (!this.alive) { await callRequest('end', call.id, this.ownData()).catch(() => undefined); return; }
      this.update({ call: accepted }); this.cursor = 0; this.generation++;
      this.queueMediaState();
      this.relay = await callRelay(call.id, this.sessionId);
      await this.syncPeers(); this.lastInbox = 0;
    } catch (cause) { if (this.state.call) await this.end(); else this.releaseMedia(); this.update({ error: friendly(cause) }); }
    finally { this.update({ busy: false }); void this.poll(); }
  }
  async decline(call: CallInfo) {
    if (this.state.busy) return;
    this.update({ busy: true, error: '' });
    try { await callRequest('decline', call.id); this.lastInbox = 0; }
    catch (cause) { this.update({ error: friendly(cause) }); }
    finally { this.update({ busy: false }); void this.poll(); }
  }
  async seen(call: string) { await callRequest('seen', call); this.lastInbox = 0; await this.poll(); }
  private async retry<T>(action: string, id: string | null, data: Record<string, unknown>): Promise<T> {
    try { return await callRequest<T>(action, id, data); }
    catch (cause) { if (cause instanceof Error && 'uncertain' in cause && !cause.uncertain) throw cause; return callRequest<T>(action, id, data); }
  }
  async end() {
    const id = this.state.call?.id ?? this.ending;
    if (!id || this.endingRequest) return;
    this.endingRequest = true;
    this.ending = id;
    // Always stop capture immediately, even if the network is unavailable.
    this.releaseMedia(); this.update({ call: null });
    try { await callRequest('end', id, this.ownData()); this.ending = null; this.update({ error: '' }); }
    catch { this.update({ error: 'Media capture stopped. Reconnecting to finish ending the call…' }); }
    finally { this.endingRequest = false; }
    this.lastInbox = 0;
  }
  private async poll() {
    if (!this.alive || !navigator.onLine) return;
    if (this.polling) { this.pollAgain = true; return; }
    this.polling = true;
    try {
      if (this.ending) { await this.end(); if (this.ending) return; }
      if (Date.now() - this.lastInbox > (this.state.call ? 5000 : 12000)) {
        const inbox = await callRequest<CallInfo[]>('inbox'); this.update({ inbox }); this.lastInbox = Date.now();
      }
      // Call events wake the inbox before heartbeat: apply membership changes
      // before consuming signals, or the first offer from a new peer is lost.
      const current = this.state.call;
      const fresh = current && this.state.inbox.find(c => c.id === current.id);
      if (fresh) this.update({ call: fresh });
      const id = this.state.call?.id;
      if (!id || this.state.busy) return;
      const generation = this.generation;
      void this.flushMediaState();
      if (Date.now() - this.lastHeartbeat > 7000) {
        const call = await callRequest<CallInfo>('heartbeat', id, this.ownData());
        if (!this.alive || generation !== this.generation) return;
        this.lastHeartbeat = Date.now(); this.update({ call });
        if (call.state === 'ended' || call.my_state !== 'joined') { this.releaseMedia(); this.update({ call: null }); return; }
      }
      if (!this.relay || this.relay.expiresAt < Date.now() + 120000) {
        this.relay = await callRelay(id, this.sessionId);
        if (generation !== this.generation) return;
        // Refresh credentials for future allocations without interrupting an
        // established media path. A real disconnect triggers ICE recovery below.
        for (const p of this.peers.values()) p.pc.setConfiguration({ iceServers: this.relay.iceServers });
      }
      await this.syncPeers();
      const signals = await callRequest<CallSignal[]>('signals', id, this.ownData({ after: this.cursor }));
      if (!this.alive || generation !== this.generation) return;
      for (const signal of signals) { await this.receive(signal); this.cursor = Math.max(this.cursor, signal.id); }
      for (const [peerId, p] of this.peers) if (['disconnected', 'failed'].includes(p.pc.iceConnectionState) && Date.now() - p.lastRestart > 10000 && this.userId < peerId) {
        p.lastRestart = Date.now(); p.pc.restartIce();
      }
    } catch (cause) {
      if (this.state.call) this.update({ error: 'Call connection interrupted. Reconnecting…' });
      // Revoked membership/account ends local capture instead of leaking it.
      if (cause instanceof Error && 'code' in cause && cause.code === '42501') { this.releaseMedia(); this.update({ call: null, inbox: [] }); }
    } finally {
      this.polling = false;
      if (this.pollAgain && this.alive) { this.pollAgain = false; window.setTimeout(() => void this.poll(), 100); }
    }
  }
  private async send(peer: string, kind: CallSignal['kind'], payload: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    const id = this.state.call?.id;
    if (!id || !this.alive) return;
    // Stable nonce makes a network retry idempotent.
    const data = this.ownData({ recipient_id: peer, kind, payload, client_id: chatRequestId() });
    try { await callRequest('signal', id, data); }
    catch { await callRequest('signal', id, data); }
  }
  private async syncPeers() {
    const call = this.state.call;
    if (!call || !this.relay || !this.state.local) return;
    const ids = call.members.filter(m => m.id !== this.userId && m.state === 'joined').map(m => m.id);
    for (const [id, p] of this.peers) if (!ids.includes(id)) { p.pc.close(); this.peers.delete(id); }
    for (const id of ids) if (!this.peers.has(id)) {
      const pc = new RTCPeerConnection({ iceServers: this.relay.iceServers, iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' });
      const p: Peer = { pc, stream: new MediaStream(), makingOffer: false, ignoreOffer: false, settingAnswer: false, candidates: [], chain: Promise.resolve(), lastRestart: Date.now(), mediaState: null };
      this.peers.set(id, p);
      const stream = this.state.local;
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
      if (call.media === 'video') pc.addTransceiver(stream.getVideoTracks()[0] ?? 'video', { direction: 'sendrecv', streams: [stream] });
      pc.ontrack = e => {
        if (!p.stream.getTracks().some(t => t.id === e.track.id)) {
          // Each peer has one sender per kind. Do not leave an ended video as
          // the element's selected track when a replacement receiver arrives.
          for (const old of p.stream.getTracks().filter(t => t.kind === e.track.kind)) p.stream.removeTrack(old);
          p.stream.addTrack(e.track);
        }
        this.remoteState();
      };
      pc.onicecandidate = e => { if (e.candidate) void this.send(id, 'candidate', e.candidate.toJSON()).catch(() => this.update({ error: 'Reconnecting the call…' })); };
      pc.onconnectionstatechange = () => {
        this.remoteState();
        if (pc.connectionState === 'connected') this.update({ error: '' });
        else if (['disconnected', 'failed'].includes(pc.connectionState)) this.update({ error: 'Call connection interrupted. Reconnecting…' });
      };
      pc.onnegotiationneeded = () => {
        p.chain = p.chain.then(async () => {
          if (pc.signalingState === 'closed') return;
          try { p.makingOffer = true; await pc.setLocalDescription(); if (pc.localDescription) await this.send(id, pc.localDescription.type as 'offer' | 'answer', pc.localDescription.toJSON()); }
          finally { p.makingOffer = false; }
        }).catch(() => this.update({ error: 'Negotiating the call connection…' }));
      };
      for (const sender of pc.getSenders()) if (sender.track?.kind === 'video') {
        const parameters = sender.getParameters(); parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
        parameters.encodings[0].maxBitrate = call.members.length > 2 ? 600000 : 1500000;
        parameters.encodings[0].scaleResolutionDownBy = call.members.length > 2 ? 2 : 1;
        void sender.setParameters(parameters).catch(() => undefined);
      }
    }
    for (const [id, p] of this.peers) {
      const latest = call.members.find(m => m.id === id)?.mediaState;
      if (latest && latest.revision > (p.mediaState?.revision ?? 0)) p.mediaState = latest;
    }
    this.remoteState();
  }
  private async receive(signal: CallSignal) {
    const p = this.peers.get(signal.sender_id);
    if (!p) return;
    if (signal.kind === 'media-state') {
      const media = signal.payload;
      if ((media.cameraState === 'enabled' || media.cameraState === 'disabled') && typeof media.screenSharing === 'boolean'
        && Number.isSafeInteger(media.revision) && media.revision > (p.mediaState?.revision ?? 0)) {
        p.mediaState = media; this.remoteState();
      }
      return; // Presentation state never waits on or changes SDP/ICE negotiation.
    }
    p.chain = p.chain.then(async () => {
      const pc = p.pc;
      if (pc.signalingState === 'closed') return;
      if (signal.kind === 'candidate') {
        const candidate = signal.payload as RTCIceCandidateInit;
        if (!pc.remoteDescription) p.candidates.push(candidate);
        else try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
        return;
      }
      const description = signal.payload as RTCSessionDescriptionInit;
      if (description.type !== signal.kind || typeof description.sdp !== 'string') return;
      const collision = description.type === 'offer' && !( !p.makingOffer && (pc.signalingState === 'stable' || p.settingAnswer));
      p.ignoreOffer = this.userId < signal.sender_id && collision;
      if (p.ignoreOffer) return;
      p.settingAnswer = description.type === 'answer';
      try { await pc.setRemoteDescription(description); } finally { p.settingAnswer = false; }
      for (const candidate of p.candidates.splice(0)) try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
      if (description.type === 'offer') { await pc.setLocalDescription(); if (pc.localDescription) await this.send(signal.sender_id, 'answer', pc.localDescription.toJSON()); }
    }).catch(() => this.update({ error: 'The connection is being recovered. You can end the call at any time.' }));
    await p.chain;
  }
  mute() {
    if (this.state.busy || !this.state.call) return;
    const muted = !this.state.muted;
    this.state.local?.getAudioTracks().forEach(t => { t.enabled = !muted; }); this.update({ muted });
  }
  private async replace(kind: 'audio' | 'video', track: MediaStreamTrack | null) {
    const generation = this.generation;
    const senders = [...this.peers.values()].flatMap(p => {
      const sender = p.pc.getTransceivers().find(t => t.receiver.track.kind === kind)?.sender;
      return sender ? [{ sender, old: sender.track }] : [];
    });
    const results = await Promise.allSettled(senders.map(({ sender }) => sender.replaceTrack(track)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      await Promise.allSettled(senders.map(({ sender, old }) => sender.replaceTrack(old)));
      throw failure.reason;
    }
    if (!this.alive || generation !== this.generation) { track?.stop(); return; }
    if (this.state.local) {
      for (const old of this.state.local.getTracks().filter(t => t.kind === kind)) this.state.local.removeTrack(old);
      if (track) this.state.local.addTrack(track);
      this.update({ local: new MediaStream(this.state.local.getTracks()) });
    }
  }
  async camera(device?: string) {
    if (this.state.busy || this.state.call?.media !== 'video') return;
    this.update({ busy: true, error: '' });
    try {
      if (this.state.camera && !device) {
        const old = this.cameraTrack;
        if (old) old.enabled = false; // Send black frames while removing the sender's track.
        this.queueMediaState(); // Notify peers without waiting for track replacement.
        try { if (!this.screen) await this.replace('video', null); }
        catch (cause) { if (old) old.enabled = true; this.queueMediaState(); throw cause; }
        this.stopCamera(old); this.cameraTrack = null; this.update({ camera: false });
      }
      else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { ...(device ? { deviceId: { exact: device } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } });
        const track = stream.getVideoTracks()[0];
        if (!this.alive || !this.state.call) { track.stop(); return; }
        const old = this.cameraTrack;
        try { if (!this.screen) await this.replace('video', track); }
        catch (cause) { track.stop(); throw cause; }
        if (!this.alive || !this.state.call) { track.stop(); return; }
        this.cameraTrack = track; this.watchCamera(track); this.stopCamera(old); this.update({ camera: true, cameraId: track.getSettings?.().deviceId ?? device ?? '' }); this.queueMediaState(); await this.devices();
      }
    } catch (cause) { this.update({ error: friendly(cause) }); }
    finally { this.update({ busy: false }); }
  }
  async microphone(device: string) {
    if (this.state.busy || !this.state.call) return;
    this.update({ busy: true, error: '' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: device }, echoCancellation: true, noiseSuppression: true } });
      const track = stream.getAudioTracks()[0];
      if (!this.alive || !this.state.call) { track.stop(); return; }
      track.enabled = !this.state.muted;
      const old = this.state.local?.getAudioTracks() ?? [];
      try { await this.replace('audio', track); } catch (cause) { track.stop(); throw cause; }
      old.forEach(t => t.stop());
      if (this.alive && this.state.call) this.update({ microphoneId: track.getSettings?.().deviceId ?? device });
    } catch (cause) { this.update({ error: friendly(cause) }); }
    finally { this.update({ busy: false }); }
  }
  async share() {
    if (this.state.busy || this.state.call?.media !== 'video') return;
    this.update({ busy: true, error: '' });
    try {
      if (this.screen) await this.stopScreen();
      else {
        // Each user click invokes the browser's permission picker afresh.
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        if (!this.alive || !this.state.call) { stream.getTracks().forEach(t => t.stop()); return; }
        this.screen = stream; const track = stream.getVideoTracks()[0];
        track.onmute = track.onunmute = () => this.queueMediaState();
        track.onended = () => void this.stopScreen().catch(() => this.update({ error: 'Screen sharing stopped. Toggle the camera to reconnect video.' }));
        try { await this.replace('video', track); }
        catch (cause) { this.screen = null; track.onended = track.onmute = track.onunmute = null; stream.getTracks().forEach(t => t.stop()); throw cause; }
        this.update({ sharing: true }); this.queueMediaState();
      }
    } catch (cause) { this.update({ error: friendly(cause) }); }
    finally { this.update({ busy: false }); }
  }
  private async stopScreen() {
    const screen = this.screen; this.screen = null;
    screen?.getTracks().forEach(t => { t.onended = t.onmute = t.onunmute = null; t.stop(); });
    this.update({ sharing: false });
    this.queueMediaState();
    if (this.state.call) await this.replace('video', this.cameraTrack?.readyState === 'live' ? this.cameraTrack : null);
  }
  private releaseMedia() {
    this.generation++;
    this.pendingMediaState = null; this.mediaRevision = 0;
    for (const p of this.peers.values()) { p.pc.onnegotiationneeded = null; p.pc.onicecandidate = null; p.pc.ontrack = null; p.pc.close(); }
    this.peers.clear(); this.screen?.getTracks().forEach(t => { t.onended = t.onmute = t.onunmute = null; t.stop(); }); this.screen = null;
    this.stopCamera(this.cameraTrack); this.cameraTrack = null; this.state.local?.getTracks().forEach(t => t.stop());
    this.relay = null; this.update({ local: null, remotes: [], muted: false, camera: false, sharing: false, microphoneId: '', cameraId: '' });
  }
  dispose() {
    this.alive = false; window.clearInterval(this.timer); window.removeEventListener('messenger-call', this.event); window.removeEventListener('online', this.event);
    window.removeEventListener('pageshow', this.event); document.removeEventListener('visibilitychange', this.event);
    const id = this.state.call?.id ?? this.ending; this.releaseMedia();
    if (id) void callRequest('end', id, this.ownData()).catch(() => undefined);
  }
}
