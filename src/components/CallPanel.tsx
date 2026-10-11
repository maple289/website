import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Mic, MicOff, Minimize2, MonitorUp, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCalls } from '@/context/CallContext';
import { TaskModal } from '@/components/TaskModal';
import { openConversation } from '@/lib/messenger';
import './Calls.css';

function Media({ stream, local = false, video = true }: { stream: MediaStream; local?: boolean; video?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.srcObject = stream;
    void node.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    return () => { node.srcObject = null; };
  }, [stream]);
  return <><video ref={ref} autoPlay playsInline muted={local} className={video ? '' : 'call-audio'} />
    {blocked && <button onClick={() => void ref.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true))}>Play call audio</button>}</>;
}
function duration(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

export function CallPanel() {
  const { state, engine } = useCalls();
  const [expanded, setExpanded] = useState(false), [now, setNow] = useState(Date.now());
  useEffect(() => { if (!state.call) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [state.call?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!state.call) setExpanded(false); }, [state.call]);
  if (!engine) return null;
  const incoming = state.inbox.find(c => c.state !== 'ended' && c.my_state === 'invited');
  const call = state.call;
  const seconds = call?.answered_at ? Math.max(0, Math.floor((now - Date.parse(call.answered_at)) / 1000)) : 0;
  const controls = call && <div className="call-controls">
    <button disabled={state.busy} aria-pressed={state.muted} onClick={() => engine.mute()}>{state.muted ? <MicOff size={18} /> : <Mic size={18} />}{state.muted ? 'Unmute' : 'Mute'}</button>
    {call.media === 'video' && <><button disabled={state.busy} aria-pressed={state.camera} onClick={() => void engine.camera()}>{state.camera ? <Video size={18} /> : <VideoOff size={18} />}{state.camera ? 'Camera off' : 'Camera on'}</button>
      {typeof navigator.mediaDevices?.getDisplayMedia === 'function' && <button disabled={state.busy} aria-pressed={state.sharing} onClick={() => void engine.share()}><MonitorUp size={18} />{state.sharing ? 'Stop sharing' : 'Share screen'}</button>}</>}
    <button className="call-end" disabled={state.busy} onClick={() => void engine.end()}><PhoneOff size={18} />End call</button>
  </div>;
  const content = call && <>
    <header><div><strong>{call.name}</strong><p>{call.state === 'ringing' ? 'Calling…' : `${call.media === 'video' ? 'Video' : 'Voice'} call · ${duration(seconds)}`}</p></div>
      <button disabled={state.busy} aria-label={expanded ? 'Minimize call' : 'Expand call'} onClick={() => setExpanded(v => !v)}>{expanded ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button></header>
    <div className="call-media-grid">
      {state.remotes.map(remote => <div className="call-media" key={remote.id}><Media stream={remote.stream} video={call.media === 'video'} /><span>{call.members.find(m => m.id === remote.id)?.name}{!remote.connected && ' · Connecting…'}</span></div>)}
      {state.local && <div className="call-media call-local"><Media stream={state.local} local video={call.media === 'video' && (state.camera || state.sharing)} /><span>{state.sharing ? 'Your screen' : 'You'}{state.muted && ' · Muted'}</span></div>}
    </div>
    {state.error && <p className="call-error" role="alert">{state.error}</p>}{controls}
    {expanded && <div className="call-devices"><label>Microphone<select disabled={state.busy} value="" onChange={e => void engine.microphone(e.target.value)}><option value="" disabled>Select microphone</option>{state.devices.filter(d => d.kind === 'audioinput').map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label>
      {call.media === 'video' && <label>Camera<select disabled={state.busy} value="" onChange={e => void engine.camera(e.target.value)}><option value="" disabled>Select camera</option>{state.devices.filter(d => d.kind === 'videoinput').map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>}</div>}
    <button className="call-conversation" disabled={state.busy} onClick={() => { setExpanded(false); openConversation(call.conversation_id); }}>Open conversation</button>
  </>;
  return <>
    {/* A global call dialog must not inherit another task's inert background. */}
    {incoming && !call && createPortal(<div className="fluent-app call-overlay"><TaskModal className="call-incoming" aria-labelledby="incoming-call-title" aria-busy={state.busy}><Phone size={30} /><h2 id="incoming-call-title">{incoming.caller_name}</h2><p>Incoming {incoming.media} call{incoming.members.length > 2 ? ` · ${incoming.name}` : ''}</p>
      {state.error && <p className="call-error" role="alert">{state.error}</p>}<div className="call-controls"><button disabled={state.busy} onClick={() => void engine.decline(incoming)}>Decline</button><button className="call-accept" disabled={state.busy} onClick={() => void engine.accept(incoming)}>{state.busy ? 'Connecting…' : 'Accept'}</button></div>
    </TaskModal></div>, document.body)}
    {call && (expanded ? createPortal(<div className="fluent-app call-overlay"><TaskModal className="call-panel call-expanded" aria-label="Active call">{content}</TaskModal></div>, document.body) : <section className="call-panel call-floating" aria-label="Active call">{content}</section>)}
    {!call && !incoming && (state.busy || state.error) && <section className="call-panel call-floating" aria-label="Call status"><p role="status">{state.busy ? 'Preparing call…' : state.error}</p>{state.error && !state.busy && <button onClick={() => engine.clearError()}>Close</button>}</section>}
  </>;
}
