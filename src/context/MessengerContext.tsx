import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { ChatRequestError, chatRequest, chatRequestId, chatOperation, chatError, type Conversation, type ChatEvent } from '@/lib/messenger';
import { MessageVisibility, type MessageDeleteScope } from '@/lib/messengerVisibility';

type Typing = { conversation_id: string; user_id: string; expires_at: number };
type MessengerValue = { conversations: Conversation[]; unread: number; connection: string; error: string; revision: number; refresh: () => Promise<void>; sessionId: string; typing: Typing[]; setTyping: (conversation: string, active: boolean) => void; visibility: MessageVisibility; removeMessage: (id: string, scope: MessageDeleteScope) => void; removeConversation: (id: string) => void };
const MessengerContext = createContext<MessengerValue | null>(null);
const emptyValue: MessengerValue = { conversations: [], unread: 0, connection: 'Connecting', error: '', revision: 0, refresh: async () => {}, sessionId: '', typing: [], setTyping: () => {}, visibility: new MessageVisibility(), removeMessage: () => {}, removeConversation: () => {} };
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
  const [visibility] = useState(() => new MessageVisibility());
  const currentConversations = useRef(conversations); currentConversations.current = conversations;
  const removeConversation = useCallback((id: string) => {
    if (!visibility.conversationUnavailable(id)) {
      const count = currentConversations.current.find(item => item.id === id)?.unread ?? 0;
      setUnread(value => Math.max(0, value - count));
    }
    visibility.revokeConversation(id);
    setConversations(current => current.filter(item => item.id !== id));
    setTypingState(current => current.filter(item => item.conversation_id !== id));
    setRevision(value => value + 1);
    window.dispatchEvent(new Event('media-access-changed'));
  }, [visibility]);
  const removeMessage = useCallback((id: string, scope: MessageDeleteScope) => {
    visibility.remove(id, scope);
    setConversations(current => current.map(item => ({ ...item, latest: item.latest ? visibility.messages([item.latest])[0] ?? null : null })));
    setRevision(value => value + 1);
  }, [visibility]);
  const alive = useRef(true), fetching = useRef(false), again = useRef(false), lastTyping = useRef(0);
  const refresh = useCallback(async () => {
    if (!active || !alive.current) return;
    if (fetching.current) { again.current = true; return; }
    fetching.current = true;
    const epoch = visibility.conversationRevision();
    try {
      const result = await chatRequest<{ conversations: Conversation[]; unread: number }>('inbox');
      if (alive.current) {
        if (epoch === visibility.conversationRevision()) { visibility.restoreSnapshot(result.conversations.map(item => item.id), epoch); setUnread(result.unread); }
        setConversations(result.conversations.filter(item => !visibility.conversationUnavailable(item.id)).map(item => ({ ...item, latest: item.latest ? visibility.messages([item.latest])[0] ?? null : null }))); setError(''); setRevision(value => value + 1);
      }
    } catch (cause) { if (alive.current) { setError(chatError(cause)); if (cause instanceof ChatRequestError && cause.code === '42501') { setConversations([]); setUnread(0); setTypingState([]); setRevision(value => value + 1); } } }
    finally { fetching.current = false; if (again.current && alive.current) { again.current = false; window.setTimeout(() => void refresh(), 150); } }
  }, [active, visibility]);
  useEffect(() => {
    alive.current = true;
    if (!active) return () => { alive.current = false; };
    let timer = 0, cancelled = false;
    const channel = supabase.channel(`messenger:user:${userId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'changed' }, ({ payload }: { payload: ChatEvent }) => {
        if (cancelled || !payload?.conversation_id) return;
        if (payload.kind === 'group-deleted' || (payload.kind === 'group-access' && payload.revoked)) {
          removeConversation(payload.conversation_id);
        } else if (payload.kind === 'group-access') visibility.restoreConversation(payload.conversation_id);
        if (payload.kind === 'media-access' || (payload.kind === 'group-access' && !payload.revoked)) window.dispatchEvent(new Event('media-access-changed'));
        // Only the authenticated user's private channel delivers these events.
        // hidden reaches that user's sessions; deleted reaches every member.
        if (payload.message_id && (payload.kind === 'deleted' || payload.kind === 'hidden')) removeMessage(payload.message_id, payload.kind === 'deleted' ? 'everyone' : 'self');
        if (payload.kind?.startsWith('call-') || payload.kind === 'group-deleted' || (payload.kind === 'group-access' && payload.revoked)) window.dispatchEvent(new CustomEvent('messenger-call', { detail: payload.kind }));
        if (payload.kind === 'call-signal') return;
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
  }, [active, userId, sessionId, refresh, removeMessage, removeConversation]);
  useEffect(() => { if (active) void supabase.realtime.setAuth(token).catch(() => undefined); }, [active, token]);
  const setTyping = useCallback((conversation: string, value: boolean) => {
    if (!active || !alive.current || (value && Date.now() - lastTyping.current < 3000)) return;
    lastTyping.current = Date.now();
    void chatOperation('typing', { conversation_id: conversation, session_id: sessionId, typing: value }).catch(() => undefined);
  }, [active, sessionId]);
  useEffect(() => { publish(userId, { conversations, unread, connection, error, revision, refresh, sessionId, typing, setTyping, visibility, removeMessage, removeConversation }); }, [publish, userId, conversations, unread, connection, error, revision, refresh, sessionId, typing, setTyping, visibility, removeMessage, removeConversation]);
  return null;
}
