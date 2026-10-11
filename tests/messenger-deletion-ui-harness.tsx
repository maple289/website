/* eslint-disable react-refresh/only-export-components -- Isolated browser fixture. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext } from '../src/context/AuthContext';
import { MessengerProvider } from '../src/context/MessengerContext';
import { Messenger } from '../src/components/Messenger';
import { DeleteConfirmationProvider } from '../src/components/DeleteConfirmationProvider';
import { supabase } from '../src/lib/supabase';
import '../src/components/FluentTheme.css';
import '../src/index.css';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let current = { id: new URLSearchParams(location.search).get('account') === 'b' ? b : a } as User;
supabase.auth.getSession = async () => ({ data: { session: { user: current, access_token: current.id } as Session }, error: null });
supabase.realtime.setAuth = async () => {};
// Deliver test events through the real provider's registered broadcast callback.
supabase.channel = (() => {
  const handlers = new Map<string, (data: { payload: unknown }) => void>();
  const receive = (event: Event) => handlers.get('changed')?.({ payload: (event as CustomEvent).detail });
  const channel = {
    on(_type: string, filter: { event: string }, callback: (data: { payload: unknown }) => void) { handlers.set(filter.event, callback); return channel; },
    subscribe(callback: (state: string) => void) { window.addEventListener('fixture-chat-event', receive); callback('SUBSCRIBED'); return channel; },
    unsubscribe() { window.removeEventListener('fixture-chat-event', receive); },
  };
  return channel;
}) as typeof supabase.channel;
supabase.removeChannel = async channel => { await channel.unsubscribe(); return 'ok'; };
const okay = async () => ({ error: null });
function Fixture() {
  const [user, setUser] = useState(current);
  const session = { user, access_token: user.id } as Session;
  const auth = { user, session, loading: false, configured: true, passwordSetup: null, signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay, cancelPasswordSetup: () => {}, signOut: async () => {} };
  return <AuthContext.Provider value={auth}><DeleteConfirmationProvider><MessengerProvider>
    <button onClick={() => { current = { id: b } as User; setUser(current); }}>Switch fixture account</button>
    <Messenger key={user.id} />
  </MessengerProvider></DeleteConfirmationProvider></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><div className="fluent-app"><Fixture /></div></React.StrictMode>);
