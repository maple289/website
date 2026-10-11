/* eslint-disable react-refresh/only-export-components -- Isolated browser fixture. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext } from '../src/context/AuthContext';
import { CallProvider } from '../src/context/CallContext';
import { CallPanel } from '../src/components/CallPanel';
import { DeleteConfirmationProvider } from '../src/components/DeleteConfirmationProvider';
import { useDeleteConfirmation } from '../src/lib/deleteConfirmation';
import { TaskModal } from '../src/components/TaskModal';
import { supabase } from '../src/lib/supabase';
import '../src/components/FluentTheme.css';
import '../src/index.css';

const user = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'fixture@example.test' } as User;
const session = { user, access_token: 'isolated-test-token' } as Session;
supabase.auth.getSession = async () => ({ data: { session }, error: null });
const okay = async () => ({ error: null });
const auth = { user, session, loading: false, configured: true, passwordSetup: null,
  signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay,
  cancelPasswordSetup: () => {}, signOut: async () => {} };

function Background() {
  const [draft, setDraft] = useState('Saved draft'), [editing, setEditing] = useState(false);
  const { requestDelete } = useDeleteConfirmation();
  const confirmation = () => void requestDelete({ title: 'Fixture confirmation', message: 'An existing task must remain intact.', onConfirm: async () => {} });
  return <main><button onClick={() => setEditing(true)}>Open edit form</button>
    <button onClick={confirmation}>Open confirmation</button>
    {editing && <div style={{ position: 'fixed', inset: 0, background: '#0004', padding: 40 }}><TaskModal aria-label="Edit fixture" style={{ background: 'white', padding: 20 }}>
      <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
      <button onClick={confirmation}>Open nested confirmation</button><button onClick={() => setEditing(false)}>Close edit form</button>
    </TaskModal></div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><div className="fluent-app"><AuthContext.Provider value={auth}>
  <DeleteConfirmationProvider><CallProvider><Background /><CallPanel /></CallProvider></DeleteConfirmationProvider>
</AuthContext.Provider></div></React.StrictMode>);
