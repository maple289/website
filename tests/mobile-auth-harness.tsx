/* eslint-disable react-refresh/only-export-components -- Isolated browser fixture. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../src/context/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { MessengerProvider } from '../src/context/MessengerContext';
import { CallProvider, useCalls } from '../src/context/CallContext';
import { DeleteConfirmationProvider } from '../src/components/DeleteConfirmationProvider';
import { AccountMenu } from '../src/components/AccountMenu';
import { CallPanel } from '../src/components/CallPanel';
import { supabase } from '../src/lib/supabase';
import { callRelay } from '../src/lib/calls';
import '../src/index.css';
import '../src/components/FluentTheme.css';

// Keep the real Auth SDK, persistence and RPC/fetch paths. Only Realtime is
// irrelevant to this session regression and must not open external sockets.
supabase.realtime.setAuth = async () => {};
supabase.channel = (() => {
  const channel = { on: () => channel, subscribe: () => channel };
  return channel;
}) as typeof supabase.channel;
supabase.removeChannel = async () => 'ok';

function Controls() {
  const { user, loading, signIn } = useAuth();
  const { engine } = useCalls();
  const [error, setError] = useState(''), [probe, setProbe] = useState('');
  const [refreshing, setRefreshing] = useState('');
  return <main>
    <output data-testid="auth-user">{loading ? 'Loading' : user?.email ?? 'Signed out'}</output>
    <AccountMenu onSignIn={() => void signIn('fixture@example.test', 'Fixture-only-123').then(result => setError(result.error ?? ''))} />
    <button disabled={!engine} onClick={() => void engine?.start('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'video')}>Start video call</button>
    <button onClick={() => void Promise.all([callRelay(), callRelay()]).then(() => setProbe('Ready'), cause => setError(cause.message))}>Check call session</button>
    <button onClick={() => { setRefreshing('Refreshing'); void supabase.auth.refreshSession().then(() => setRefreshing('Finished'), () => setRefreshing('Finished')); }}>Refresh fixture session</button>
    <output data-testid="refresh-state">{refreshing}</output>
    <output data-testid="probe">{probe}</output>{error && <p role="alert">{error}</p>}
    <CallPanel />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><div className="fluent-app"><AuthProvider>
  <DeleteConfirmationProvider><MessengerProvider><CallProvider><Controls /></CallProvider></MessengerProvider></DeleteConfirmationProvider>
</AuthProvider></div></React.StrictMode>);
