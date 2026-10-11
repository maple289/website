import { useEffect, useRef, useState } from 'react';
import { Bell, MessageCircle, PhoneMissed, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMessenger } from '@/context/MessengerContext';
import { useCalls } from '@/context/CallContext';
import { openConversation } from '@/lib/messenger';
import './Messenger.css';

export function MessageBell() {
  const { user } = useAuth();
  const { conversations, unread, error } = useMessenger();
  const { state: calls, engine } = useCalls();
  const [callError, setCallError] = useState('');
  const pending = useRef(false);
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (!user) return null;
  const entries = conversations.filter(item => item.unread > 0 && !item.muted).slice(0, 6);
  const notices = calls.inbox.filter(c => !c.seen && (c.my_state === 'missed' || c.my_state === 'invited'));
  const count = unread + notices.length;
  const openCall = async (id: string, conversation: string) => {
    if (pending.current) return;
    pending.current = true; setCallError('');
    try { await engine?.seen(id); setOpen(false); openConversation(conversation); }
    catch { setCallError('The notification could not be marked as read. Please try again.'); }
    finally { pending.current = false; }
  };
  return <div className="chat-bell" ref={root}>
    <button type="button" className="chat-bell-button" aria-label={`Notifications: ${count} unread`} aria-expanded={open} aria-controls={open ? 'chat-notifications' : undefined} onClick={() => setOpen(value => !value)}><Bell size={21} />{count > 0 && <span className="chat-badge">{count > 99 ? '99+' : count}</span>}</button>
    {open && <section id="chat-notifications" className="chat-notifications" aria-label="Message notifications"><h2>Notifications</h2>
      {error && <p role="status">Notifications are temporarily unavailable.</p>}
      {callError && <p role="alert">{callError}</p>}
      {!entries.length && !notices.length && <p>{unread ? 'Unread messages are in muted or older conversations.' : 'No unread notifications.'}</p>}
      {notices.map(call => <button key={call.id} className="chat-notification" disabled={calls.busy} onClick={() => void openCall(call.id, call.conversation_id)}>{call.my_state === 'invited' ? <Users size={19} /> : <PhoneMissed size={19} />}<span><strong>{call.name}</strong><span>{call.my_state === 'invited' ? `${call.members.length > 2 ? 'Group call invitation' : 'Incoming call'}` : 'Missed call'} · {call.media}</span><time dateTime={call.started_at}>{new Date(call.started_at).toLocaleString()}</time></span></button>)}
      {entries.map(item => <button key={item.id} className="chat-notification" onClick={() => { setOpen(false); openConversation(item.id); }}><MessageCircle size={19} /><span><strong>{item.name}</strong><span>{item.latest?.sender_name}: {item.latest?.body || 'Sent an attachment'}</span><time dateTime={item.latest?.created_at}>{item.latest ? new Date(item.latest.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</time></span><b>{item.unread}</b></button>)}
      <button className="chat-notifications-open" onClick={() => { setOpen(false); openConversation(); }}>Open Messages</button>
    </section>}
  </div>;
}
