import '@/components/MediaGallery.css';
import '@/components/FluentTheme.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AuthContext} from '@/context/AuthContext';
import {DeleteConfirmationProvider} from '@/components/DeleteConfirmationProvider';
import {VideoProcessingJobs} from '@/components/VideoProcessingJobs';
import {supabase} from '@/lib/supabase';
import '@/index.css';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: 'fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, user };
supabase.auth.getSession = async () => ({ data: { session }, error: null });
const okay = async () => ({ error: null });
const auth = { user, session, loading: false, configured: true, passwordSetup: null,
  signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay,
  cancelPasswordSetup: () => {}, signOut: async () => {} };
createRoot(document.getElementById('root')!).render(
  <div className="fluent-app"><AuthContext.Provider value={auth}><DeleteConfirmationProvider>
    <main className="media-page"><div className="mg-page">
      <VideoProcessingJobs searchTerm="" visibleIds={[]} />
    </div></main>
  </DeleteConfirmationProvider></AuthContext.Provider></div>
);
