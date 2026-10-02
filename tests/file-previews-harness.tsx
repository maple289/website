/* eslint-disable react-refresh/only-export-components -- Standalone test entry. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { User, Session } from '@supabase/supabase-js';
import { FileManager } from '@/components/FileManager';
import { AuthContext } from '@/context/AuthContext';
import { DeleteConfirmationProvider } from '@/components/DeleteConfirmationProvider';
import { supabase } from '@/lib/supabase';
import { initializeAppHistory } from '@/lib/appHistory';
import '@/index.css';
import '@/components/FluentTheme.css';
initializeAppHistory();
const guest = new URLSearchParams(location.search).has('guest');
const user = guest ? null : { id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.test' } as User;
const session = guest ? null : { access_token: 'fixture', refresh_token: 'fixture', user } as Session;
supabase.auth.getSession = async () => ({ data: { session }, error: null });
const okay = async () => ({ error: null });
const auth = { user, session, loading: false, configured: true, passwordSetup: null, signIn: okay, signUp: okay,
  requestRegistration: okay, completeInitialPassword: okay, cancelPasswordSetup: () => {}, signOut: async () => {} };
function Harness() {
  const [search, setSearch] = useState('');
  return <div className="fluent-app"><AuthContext.Provider value={auth}><DeleteConfirmationProvider>
    <header className="bg-slate-900 p-4 text-lg font-semibold text-white">MyHostage · Files</header>
    <FileManager searchTerm={search} onSearchTermChange={setSearch} publicOnly={guest} />
  </DeleteConfirmationProvider></AuthContext.Provider></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
