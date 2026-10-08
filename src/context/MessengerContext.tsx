import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { ChatRequestError, chatRequest, chatRequestId, chatOperation, chatError, type Conversation, type ChatEvent } from '@/lib/messenger';

type Typing = { conversation_id: string; user_id: string; expires_at: number };
type MessengerValue = { conversations: Conversation[]; unread: number; connection: string; error: string; revision: number; refresh: () => Promise<void>; sessionId: string; typing: Typing[]; setTyping: (conversation: string, active: boolean) => void };
const MessengerContext = createContext<MessengerValue | null>(null);
const emptyValue: MessengerValue = { conversations: [], unread: 0, connection: 'Connecting', error: '', revision: 0, refresh: async () => {}, sessionId: '', typing: [], setTyping: () => {} };
// eslint-disable-next-line react-refresh/only-export-components
export function useMessenger() { const value = useContext(MessengerContext); if (!value) throw new Error('MessengerProvider is required'); return value; }

export function MessengerProvider({ children }: { children: ReactNode }) {
  const { user, session, passwordSetup, configured } = useAuth();
  const [snapshot, setSnapshot] = useState<{ owner: string; value: MessengerValue } | null>(null);
  const publish = useCallback((owner: string, value: MessengerValue) => setSnapshot({ owner, value }), []);
  const active = !!user && !!session && !passwordSetup && configured;
  // Keying the complete connection/cache prevents one user's data from appearing
  // briefly while another account signs in on the same browser.
  // Only the connection engine is keyed. Remounting the whole application on
  // sign-in would reset existing routes and registration/settings dialog state.
  return <MessengerContext.Provider value={active && snapshot?.owner === user?.id ? snapshot.value : emptyValue}>
    <MessengerSession key={passwordSetup ? 'setup' : user?.id ?? 'guest'} active={active} token={session?.access_token ?? ''} userId={user?.id ?? ''} publish={publish} />
    {children}
  </MessengerContext.Provider>;
}
function MessengerSession({ active, token, userId, publish }: { active: boolean; token: string; userId: string; publish: (owner: string, value: MessengerValue) => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]), [unread, setUnread] = useState(0);
  const [connection, setConnection] = useState('Connecting'), [error, setError] = useState(''), [revision, setRevision] = useState(0), [typing, setTypingState] = useState<Typing[]>([]);
  const [sessionId] = useState(chatRequestId);
  const alive = useRef(true), fetching = useRef(false), again = useRef(false), lastTyping = useRef(0);
  const refresh = useCallback(async () => {
    if (!active || !alive.current) return;
    if (fetching.current) { again.current = true; return; }
    fetching.current = true;
    try {
      const result = await chatRequest<{ conversations: Conversation[]; unread: number }>('inbox');
      if (alive.current) { setConversations(result.conversations); setUnread(result.unread); setError(''); setRevision(value => value + 1); }
    } catch (cause) { if (alive.current) { setError(chatError(cause)); if (cause instanceof ChatRequestError && cause.code === '42501') { setConversations([]); setUnread(0); setTypingState([]); setRevision(value => value + 1); } } }
    finally { fetching.current = false; if (again.current && alive.current) { again.current = false; window.setTimeout(() => void refresh(), 150); } }
  }, [active]);
  useEffect(() => {
    alive.current = true;
    if (!active) return () => { alive.current = false; };
    let timer = 0, cancelled = false;
    const channel = supabase.channel(`messenger:user:${userId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'changed' }, ({ payload }: { payload: ChatEvent }) => {
        if (cancelled || !payload?.conversation_id) return;
        window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 120);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (cancelled || typeof payload?.conversation_id !== 'string' || typeof payload?.user_id !== 'string') return;
        setTypingState(current => [...current.filter(item => item.user_id !== payload.user_id || item.conversation_id !== payload.conversation_id),
          ...(payload.typing ? [{ conversation_id: payload.conversation_id, user_id: payload.user_id, expires_at: Math.min(Number(payload.expires_at) || 0, Date.now() + 6000) }] : [])]);
      });
    void supabase.realtime.setAuth(token).then(() => {
      if (cancelled) return;
      channel.subscribe(status => { if (cancelled) return; setConnection(status === 'SUBSCRIBED' ? 'Connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'Reconnecting' : 'Connecting'); if (status === 'SUBSCRIBED') void refresh(); });
    }).catch(() => { if (!cancelled) setConnection('Reconnecting'); });
    const heartbeat = () => {
      if (document.hidden || !navigator.onLine) return;
      void chatRequest('heartbeat', null, { session_id: sessionId }).catch(cause => { if (alive.current) setError(chatError(cause)); });
      void refresh();
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 20000);
    const expiry = window.setInterval(() => setTypingState(items => { const fresh = items.filter(item => item.expires_at > Date.now()); return fresh.length === items.length ? items : fresh; }), 1000);
    window.addEventListener('online', heartbeat); window.addEventListener('focus', heartbeat); document.addEventListener('visibilitychange', heartbeat);
    return () => {
      cancelled = true; alive.current = false; window.clearTimeout(timer); window.clearInterval(interval); window.clearInterval(expiry);
      window.removeEventListener('online', heartbeat); window.removeEventListener('focus', heartbeat); document.removeEventListener('visibilitychange', heartbeat);
      void supabase.removeChannel(channel);
      void chatRequest('session-end', null, { session_id: sessionId }).catch(() => undefined);
    };
    // Token refresh updates the existing connection in the separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, userId, sessionId, refresh]);
  useEffect(() => { if (active) void supabase.realtime.setAuth(token).catch(() => undefined); }, [active, token]);
  const setTyping = useCallback((conversation: string, value: boolean) => {
    if (!active || !alive.current || (value && Date.now() - lastTyping.current < 3000)) return;
    lastTyping.current = Date.now();
    void chatOperation('typing', { conversation_id: conversation, session_id: sessionId, typing: value }).catch(() => undefined);
  }, [active, sessionId]);
  useEffect(() => { publish(userId, { conversations, unread, connection, error, revision, refresh, sessionId, typing, setTyping }); }, [publish, userId, conversations, unread, connection, error, revision, refresh, sessionId, typing, setTyping]);
  return null;
}
