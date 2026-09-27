/* eslint-disable react-refresh/only-export-components -- Standalone browser test entry, not an imported component module. */
import { useFileNavigation } from '../src/hooks/useFileNavigation';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { User } from '@supabase/supabase-js';
import { AuthContext } from '../src/context/AuthContext';
import { SettingsPage } from '../src/components/SettingsPage';
import { PhotoLibrary } from '../src/components/PhotoLibrary';
import { DeleteConfirmationProvider } from '../src/components/DeleteConfirmationProvider';
import { initializeAppHistory } from '../src/lib/appHistory';
import { supabase } from '../src/lib/supabase';
import '../src/index.css';

initializeAppHistory();
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test' } as User;
const okay = async () => ({ error: null });
supabase.auth.updateUser = async () => ({ data: { user }, error: null });
const auth = { user, session: null, loading: false, configured: true, passwordSetup: null,
  signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay,
  cancelPasswordSetup: () => {}, signOut: async () => {} };
function FilesFixture() {
  const navigation = useFileNavigation(false, () => {});
  return <button onClick={() => navigation.navigate({ folder: 'Documents' })}>Open folder</button>;
}
function Harness() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const sync = () => setRoute(location.hash); window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync); }, []);
  return <AuthContext.Provider value={auth}><DeleteConfirmationProvider>
    {route === '#/settings' ? <SettingsPage /> : <div>
      <h1 data-testid="source">{route || 'Home'}</h1>
      <a href="#/settings">Settings</a>
      {route.startsWith('#/files') && <FilesFixture />} 
      {route === '#/photos' && <PhotoLibrary searchTerm="" />}
    </div>}
  </DeleteConfirmationProvider></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>);
