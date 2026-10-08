import { useEffect, useRef, useState } from 'react';
import { Bell, MessageCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMessenger } from '@/context/MessengerContext';
import { openConversation } from '@/lib/messenger';
import './Messenger.css';

export function MessageBell() {
  const { user } = useAuth();
  const { conversations, unread, error } = useMessenger();
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
  return <div className="chat-bell" ref={root}>
    <button type="button" className="chat-bell-button" aria-label={`Messages: ${unread} unread`} aria-expanded={open} aria-controls={open ? 'chat-notifications' : undefined} onClick={() => setOpen(value => !value)}><Bell size={21} />{unread > 0 && <span className="chat-badge">{unread > 99 ? '99+' : unread}</span>}</button>
    {open && <section id="chat-notifications" className="chat-notifications" aria-label="Message notifications"><h2>Notifications</h2>
      {error && <p role="status">Notifications are temporarily unavailable.</p>}
      {!entries.length && <p>{unread ? 'Unread messages are in muted or older conversations.' : 'No unread messages.'}</p>}
      {entries.map(item => <button key={item.id} className="chat-notification" onClick={() => { setOpen(false); openConversation(item.id); }}><MessageCircle size={19} /><span><strong>{item.name}</strong><span>{item.latest?.sender_name}: {item.latest?.body || 'Sent an attachment'}</span><time dateTime={item.latest?.created_at}>{item.latest ? new Date(item.latest.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</time></span><b>{item.unread}</b></button>)}
      <button className="chat-notifications-open" onClick={() => { setOpen(false); openConversation(); }}>Open Messages</button>
    </section>}
  </div>;
}
