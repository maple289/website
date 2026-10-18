/* eslint-disable react-refresh/only-export-components -- Isolated browser fixture. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext } from '../src/context/AuthContext';
import { MessengerProvider } from '../src/context/MessengerContext';
import { CallProvider } from '../src/context/CallContext';
import { NotificationProvider } from '../src/context/NotificationContext';
import { NotificationSettings } from '../src/components/NotificationSettings';
import { CallPanel } from '../src/components/CallPanel';
import { DeleteConfirmationProvider } from '../src/components/DeleteConfirmationProvider';
import { notificationCore, notificationWorker } from '../src/lib/notifications';
import { clearLocalSession } from '../src/lib/authSessionStorage';
import { supabase } from '../src/lib/supabase';
import '../src/components/FluentTheme.css';
import '../src/index.css';

const user = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'fixture@example.test' } as User;
const session = { user, access_token: 'isolated-test-token' } as Session;
supabase.auth.getSession = async () => ({ data: { session }, error: null });
const okay = async () => ({ error: null });
function Fixture() {
  const [loggedOut, logout] = useState(false), [hash, setHash] = useState(location.hash);
  useEffect(() => { const change = () => setHash(location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => { void Promise.all([notificationCore(), notificationWorker()]).then(() => { document.body.dataset.notificationReady = 'true'; }); }, []);
  const auth = { user: loggedOut ? null : user, session: loggedOut ? null : session, loading: false, configured: true, passwordSetup: null,
    signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay,
    cancelPasswordSetup: () => {}, signOut: async () => { clearLocalSession(); logout(true); } };
  return <div className="fluent-app"><AuthContext.Provider value={auth}><DeleteConfirmationProvider><MessengerProvider><CallProvider><NotificationProvider>
    <main style={{ maxWidth: 700, margin: 'auto', padding: 20 }}><h1>Notification fixture</h1><p data-testid="route">{hash || '#/'}</p>
      <button onClick={() => window.dispatchEvent(new Event('online'))}>Check notifications</button>
      <button onClick={() => { clearLocalSession(); logout(true); }}>Log out</button>
      {!loggedOut && <NotificationSettings />}
      <input aria-label="Untouched draft" defaultValue="Saved draft" />
    </main><CallPanel />
  </NotificationProvider></CallProvider></MessengerProvider></DeleteConfirmationProvider></AuthContext.Provider></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
