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
import '../src/components/Calls.css';
import '../src/index.css';

let current = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'fixture@example.test' } as User;
supabase.auth.getSession = async () => ({ data: { session: { user: current, access_token: current.id } as Session }, error: null });
// Keep the real provider's polling/event logic without a production websocket.
supabase.realtime.setAuth = async () => {};
supabase.channel = (() => { const channel = { on() { return channel; }, subscribe(callback: (state: string) => void) { callback('SUBSCRIBED'); return channel; } }; return channel; }) as typeof supabase.channel;
supabase.removeChannel = async () => 'ok';
const okay = async () => ({ error: null });
function Fixture() {
  const [user, setUser] = useState(current);
  const session = { user, access_token: user.id } as Session;
  const auth = { user, session, loading: false, configured: true, passwordSetup: null, signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay, cancelPasswordSetup: () => {}, signOut: async () => {} };
  return <AuthContext.Provider value={auth}><DeleteConfirmationProvider><MessengerProvider>
    <button onClick={() => { current = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'other@example.test' } as User; window.location.hash = '#/messages'; setUser(current); }}>Switch fixture account</button>
    <Messenger key={user.id} />
  </MessengerProvider></DeleteConfirmationProvider></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><div className="fluent-app"><Fixture /></div></React.StrictMode>);
