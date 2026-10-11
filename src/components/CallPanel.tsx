import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, Maximize2, Mic, MicOff, Minimize2, MonitorUp, Move, Phone, PhoneOff, Settings2, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useCalls } from '@/context/CallContext';
import { useAuth } from '@/hooks/useAuth';
import { TaskModal } from '@/components/TaskModal';
import { useModalLayer } from '@/hooks/useModalLayer';
import { useCallFullscreen } from '@/hooks/useCallFullscreen';
import { useCallRingtone } from '@/hooks/useCallRingtone';
import { useVideoTrackState } from '@/hooks/useVideoTrackState';
import { useVisualViewportBounds } from '@/hooks/useVisualViewportBounds';
import { useCallAudioOutput } from '@/hooks/useCallAudioOutput';
import { phoneOutputPair, type CallAudioOutput } from '@/lib/callAudioOutput';
import { openConversation } from '@/lib/messenger';
import type { CallEngine, CallState } from '@/lib/callEngine';
import type { CallInfo } from '@/lib/calls';
import './Calls.css';

function Media({ stream, local = false, video = true, visible = true, output }: { stream: MediaStream; local?: boolean; video?: boolean; visible?: boolean; output?: CallAudioOutput }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let alive = true;
    const binding = !local ? output?.register(node) : undefined;
    node.srcObject = stream;
    // Prefer the initial output before playback, but a slow output API must not silence the call.
    let timer = 0;
    const ready = binding ? Promise.race([binding.ready, new Promise<void>(resolve => { timer = window.setTimeout(resolve, 1800); })]) : Promise.resolve();
    void ready.then(() => { window.clearTimeout(timer); if (alive) return node.play(); }).then(() => { if (alive) setBlocked(false); }).catch(() => { if (alive) setBlocked(true); });
    return () => { alive = false; window.clearTimeout(timer); binding?.release(); node.srcObject = null; };
  }, [stream, local, output]);
  return <><video ref={ref} autoPlay={local} playsInline muted={local} className={video ? 'call-video' : 'call-audio'} style={video && !visible ? { visibility: 'hidden' } : undefined} />
    {blocked && !local && <button className="call-play-audio" onClick={() => void ref.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true))}>Play call audio</button>}</>;
}
function duration(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function Avatar({ name }: { name: string }) { return <span className="call-avatar" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || <Phone size={30} />}</span>; }

function RemoteVideo({ name, remote, output }: { name: string; remote?: CallState['remotes'][number]; output: CallAudioOutput }) {
  const media = remote?.mediaState;
  const visible = useVideoTrackState(remote?.stream ?? null, !media || media.cameraState === 'enabled' || media.screenSharing);
  return <div className="call-remote" data-video-state={visible ? 'enabled' : 'disabled'}>
    {remote && <Media stream={remote.stream} output={output} visible={visible} />}
    {!visible && <div className="call-video-placeholder call-camera-off"><VideoOff size={28} /><span>{name}</span><small>{media?.cameraState === 'disabled' && !media.screenSharing ? 'Camera off' : remote?.connected ? 'Video unavailable' : 'Connecting…'}</small></div>}
    <span className="call-remote-name">{name}{remote && !remote.connected ? ' · Connecting…' : ''}</span>
  </div>;
}

const corners = ['top-right', 'bottom-right', 'bottom-left', 'top-left'] as const;
function SelfView({ state }: { state: CallState }) {
  const visible = useVideoTrackState(state.local, state.camera || state.sharing);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; left: number; top: number } | null>(null);
  const [corner, setCorner] = useState<(typeof corners)[number]>('top-right');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    // Corners automatically fit a resized stage; cancel an in-progress drag.
    const resized = () => { drag.current = null; setPosition(null); };
    const observer = new ResizeObserver(resized); observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const node = ref.current, parent = node?.parentElement;
    if (!node || !parent) return;
    const bounds = node.getBoundingClientRect(), stage = parent.getBoundingClientRect();
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left: bounds.left - stage.left, top: bounds.top - stage.top };
    node.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const node = ref.current, parent = node?.parentElement, active = drag.current;
    if (!node || !parent || !active || event.pointerId !== active.id) return;
    const panel = parent.closest<HTMLElement>('.call-panel');
    const full = panel?.classList.contains('call-fullscreen');
    const top = full && panel ? parseFloat(panel.style.getPropertyValue('--call-header-height')) || 80 : 0;
    const bottom = full && panel ? parseFloat(panel.style.getPropertyValue('--call-footer-height')) || 140 : 0;
    setPosition({ left: Math.max(8, Math.min(parent.clientWidth - node.offsetWidth - 8, active.left + event.clientX - active.startX)),
      top: Math.max(top + 8, Math.min(parent.clientHeight - bottom - node.offsetHeight - 8, active.top + event.clientY - active.startY)) });
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const node = ref.current, parent = node?.parentElement;
    if (!node || !parent || !drag.current || event.pointerId !== drag.current.id) return;
    const bounds = node.getBoundingClientRect(), stage = parent.getBoundingClientRect();
    const right = bounds.left + bounds.width / 2 > stage.left + stage.width / 2;
    const bottom = bounds.top + bounds.height / 2 > stage.top + stage.height / 2;
    setCorner(bottom ? (right ? 'bottom-right' : 'bottom-left') : (right ? 'top-right' : 'top-left'));
    drag.current = null; setPosition(null);
  };
  return <div ref={ref} className={`call-self-view ${state.sharing ? 'call-self-screen' : ''}`} data-corner={corner} data-video-state={visible ? 'enabled' : 'disabled'}
    style={position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' } : undefined}
    onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setPosition(null); }}>
    {state.local && <Media stream={state.local} local visible={visible} />}
    {!visible && <div className="call-self-off"><VideoOff size={22} /><span>{state.sharing ? 'Screen unavailable' : state.camera ? 'Camera unavailable' : 'Camera off'}</span></div>}
    <span className="call-self-label">{state.sharing ? 'Your screen' : 'You'}{state.muted ? ' · Muted' : ''}</span>
    <button aria-label="Move self-view to next corner" title="Drag self-view, or move to next corner" onClick={() => setCorner(corners[(corners.indexOf(corner) + 1) % corners.length])}><Move size={14} /></button>
  </div>;
}

function ActiveCall({ call, state, engine }: { call: CallInfo; state: CallState; engine: CallEngine }) {
  const { user } = useAuth();
  const ref = useRef<HTMLElement>(null);
  useVisualViewportBounds(ref);
  const { fullscreen, enter, exit } = useCallFullscreen(ref);
  useModalLayer(ref, fullscreen);
  const [now, setNow] = useState(Date.now()), [selfVisible, setSelfVisible] = useState(true);
  const [devicesVisible, setDevicesVisible] = useState(false);
  const { output, state: audio } = useCallAudioOutput(call.media);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const node = ref.current;
    const header = node?.querySelector<HTMLElement>('.call-header'), footer = node?.querySelector<HTMLElement>('.call-footer');
    if (!node || !header || !footer) return;
    const measure = () => {
      node.style.setProperty('--call-header-height', `${header.offsetHeight}px`);
      node.style.setProperty('--call-footer-height', `${footer.offsetHeight}px`);
    };
    const observer = new ResizeObserver(measure); observer.observe(header); observer.observe(footer); measure();
    return () => observer.disconnect();
  }, []);
  const seconds = call.answered_at ? Math.max(0, Math.floor((now - Date.parse(call.answered_at)) / 1000)) : 0;
  const video = call.media === 'video';
  const remotes = call.members.filter(m => m.id !== user?.id && (m.state === 'joined' || m.state === 'invited'));
  const pair = phoneOutputPair(audio.devices);
  const toggleAvailable = audio.supported && !!pair.speaker && !!pair.receiver;
  const speakerOn = !audio.pending && audio.kind === 'speaker';
  const receiverOn = !audio.pending && audio.kind === 'receiver';
  const routeLabel = audio.pending ? 'Switching audio…' : speakerOn ? 'Loudspeaker' : receiverOn ? 'Earpiece' : audio.label;
  const status = call.state === 'ringing' ? 'Calling…' : `${video ? 'Video' : 'Voice'} call · ${duration(seconds)}`;
  return <section ref={ref} className={`fluent-app call-panel call-active ${video ? 'call-video-panel' : 'call-voice-panel'} ${fullscreen ? 'call-fullscreen' : 'call-floating'}`}
    role={fullscreen ? 'dialog' : 'region'} aria-modal={fullscreen ? true : undefined} aria-label="Active call" tabIndex={-1}>
    <header className="call-header"><div><strong>{call.name}</strong><p role="status">{status}{audio.mobile && <span className="call-route-status"> · {routeLabel}</span>}</p></div>
      <button disabled={state.busy} aria-label={fullscreen ? 'Exit fullscreen' : 'Expand call'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen call'} onClick={() => fullscreen ? void exit() : enter()}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button></header>
    {video ? <div className="call-stage">
      <div className={`call-remote-grid ${remotes.length > 1 ? 'call-group-grid' : ''}`}>
        {remotes.map(member => <RemoteVideo key={member.id} name={member.name} remote={state.remotes.find(r => r.id === member.id)} output={output} />)}
        {!remotes.length && <div className="call-video-placeholder"><Video size={36} /><p>Waiting for participants…</p></div>}
      </div>
      {selfVisible && <SelfView state={state} />}
    </div> : <div className="call-voice-stage">
      {remotes.map(member => <div className="call-voice-person" key={member.id}><Avatar name={member.name} /><strong>{member.name}</strong></div>)}
      {!remotes.length && <div className="call-voice-person"><Avatar name={call.name} /><strong>{call.name}</strong></div>}
      {state.remotes.map(remote => <Media key={remote.id} stream={remote.stream} video={false} output={output} />)}
      <p>Voice call · {call.state === 'ringing' ? 'Ringing' : duration(seconds)}</p>
    </div>}
    <footer className="call-footer">
      {state.error && <p className="call-error" role="alert">{state.error}</p>}
      <div className="call-controls">
        <button disabled={state.busy} title={state.muted ? 'Unmute' : 'Mute'} aria-pressed={state.muted} onClick={() => engine.mute()}>{state.muted ? <MicOff size={18} /> : <Mic size={18} />}<span>{state.muted ? 'Unmute' : 'Mute'}</span></button>
        {video && <><button disabled={state.busy} title={state.camera ? 'Camera off' : 'Camera on'} aria-pressed={!state.camera} onClick={() => void engine.camera()}>{state.camera ? <Video size={18} /> : <VideoOff size={18} />}<span>{state.camera ? 'Camera off' : 'Camera on'}</span></button>
          <button title={selfVisible ? 'Hide self-view' : 'Show self-view'} aria-pressed={!selfVisible} onClick={() => setSelfVisible(v => !v)}>{selfVisible ? <EyeOff size={18} /> : <Eye size={18} />}<span>{selfVisible ? 'Hide self-view' : 'Show self-view'}</span></button>
          {typeof navigator.mediaDevices?.getDisplayMedia === 'function' && <button disabled={state.busy} title={state.sharing ? 'Stop sharing' : 'Share screen'} aria-pressed={state.sharing} onClick={() => void engine.share()}><MonitorUp size={18} /><span>{state.sharing ? 'Stop sharing' : 'Share screen'}</span></button>}</>}
        {audio.mobile && <button className={speakerOn ? 'call-speaker-on' : ''} aria-label="Speaker" aria-pressed={speakerOn ? true : receiverOn ? false : undefined}
          disabled={audio.pending} title={toggleAvailable ? speakerOn ? 'Switch to earpiece' : 'Switch to loudspeaker' : 'Audio output options'}
          onClick={() => { if (toggleAvailable) void output.toggleSpeaker(); else setDevicesVisible(v => !v); }}>
          <Volume2 size={18} /><span>{speakerOn ? 'Speaker on' : receiverOn ? 'Speaker off' : 'Speaker'}</span></button>}
        <button title="Devices" aria-expanded={devicesVisible} onClick={() => setDevicesVisible(v => !v)}><Settings2 size={18} /><span>Devices</span></button>
        <button className="call-end" title="End call" disabled={state.busy} onClick={() => void engine.end()}><PhoneOff size={18} /><span>End call</span></button>
      </div>
      {devicesVisible && <div className="call-devices"><label>Microphone<select disabled={state.busy} value="" onChange={e => void engine.microphone(e.target.value)}><option value="" disabled>Select microphone</option>{state.devices.filter(d => d.kind === 'audioinput').map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label>
        {video && <label>Camera<select disabled={state.busy} value="" onChange={e => void engine.camera(e.target.value)}><option value="" disabled>Select camera</option>{state.devices.filter(d => d.kind === 'videoinput').map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>}
        <div className="call-output-options"><p role="status">Audio output: {routeLabel}</p>
          {audio.mobile && !toggleAvailable && <p>{audio.supported ? 'Speaker/earpiece switching is unavailable. Choose an output below or use your phone’s audio controls.' : 'Your phone controls the audio route. Use its audio controls or a connected headset.'}</p>}
          {audio.supported && <label>Audio output<select disabled={audio.pending} value={audio.sinkId ?? 'unconfirmed'} onChange={e => void output.select(e.target.value)}>
            {audio.sinkId === null && <option value="unconfirmed" disabled>Output not confirmed</option>}<option value="">System default</option>
            {audio.sinkId && !audio.devices.some(d => d.kind === 'audiooutput' && d.deviceId === audio.sinkId) && <option value={audio.sinkId} disabled>Output unavailable</option>}
            {audio.devices.filter(d => d.kind === 'audiooutput' && d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Audio output ${i + 1}`}</option>)}
          </select></label>}
          {audio.picker && <button disabled={audio.pending} onClick={() => void output.choose()}>Choose audio output</button>}
          {audio.error && <p className="call-routing-error" role="alert">{audio.error}</p>}
        </div>
      </div>}
      <button className="call-conversation" disabled={state.busy} onClick={() => { void exit().then(closed => { if (closed) openConversation(call.conversation_id); }); }}>Open conversation</button>
    </footer>
  </section>;
}

export function CallPanel() {
  const { state, engine } = useCalls();
  const incoming = state.inbox.find(c => c.state !== 'ended' && c.my_state === 'invited');
  const ringtone = useCallRingtone(incoming && !state.call && !state.busy && engine ? incoming.id : null, !!engine);
  if (!engine) return null;
  return <>
    {/* A global call surface escapes parent clipping and other tasks' inert backgrounds. */}
    {incoming && !state.call && createPortal(<div className="fluent-app call-overlay"><TaskModal className="call-incoming" aria-labelledby="incoming-call-title" aria-busy={state.busy}>
      {incoming.media === 'video' ? <Video size={30} /> : <Phone size={30} />}<h2 id="incoming-call-title">{incoming.caller_name}</h2><p>Incoming {incoming.media} call{incoming.members.length > 2 ? ` · ${incoming.name}` : ''}</p>
      <button data-call-sound-control className="call-ring-control" disabled={state.busy} onClick={ringtone.blocked && !ringtone.muted ? ringtone.unlock : ringtone.toggle}>{ringtone.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}{ringtone.muted ? 'Unmute ringing' : ringtone.blocked ? 'Enable call sound' : 'Mute ringing'}</button>
      {state.error && <p className="call-error" role="alert">{state.error}</p>}<div className="call-controls"><button disabled={state.busy} onClick={() => void engine.decline(incoming)}>Decline</button><button className="call-accept" disabled={state.busy} onClick={() => void engine.accept(incoming)}>{state.busy ? 'Connecting…' : 'Accept'}</button></div>
    </TaskModal></div>, document.body)}
    {state.call && createPortal(<ActiveCall key={state.call.id} call={state.call} state={state} engine={engine} />, document.body)}
    {!state.call && !incoming && (state.busy || state.error) && <section className="call-panel call-floating" aria-label="Call status"><p role="status">{state.busy ? 'Preparing call…' : state.error}</p>{state.error && !state.busy && <button onClick={() => engine.clearError()}>Close</button>}</section>}
  </>;
}
