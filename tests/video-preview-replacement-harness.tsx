/* eslint-disable react-refresh/only-export-components -- Standalone isolated browser fixture. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '@/context/AuthContext';
import { DeleteConfirmationProvider } from '@/components/DeleteConfirmationProvider';
import { EditVideoModal } from '@/components/EditVideoModal';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import '@/index.css';

const owner = '11111111-1111-4111-8111-111111111111';
const user = { id: owner, email: 'fixture@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: 'fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, user };
supabase.auth.getSession = async () => ({ data: { session }, error: null });
const okay = async () => ({ error: null });
const auth = { user, session, loading: false, configured: true, passwordSetup: null, signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay, cancelPasswordSetup: () => {}, signOut: async () => {} };
const video = { id: '22222222-2222-4222-8222-222222222222', owner_id: owner, file_name: 'Fixture video', visibility: 'private',
  preview_url: null, preview_path: `${owner}/video-previews/old.webp`, storage_path: `${owner}/video.mp4`,
  processing_status: 'ready', created_at: '2026-01-01T00:00:00Z' } as Video;
function Harness() {
  const [open, setOpen] = useState(true), [saved, setSaved] = useState(0);
  return <AuthContext.Provider value={auth}><DeleteConfirmationProvider><output data-preview-saved={saved}>{saved ? 'Preview saved' : 'No changes saved'}</output>
    {open && <EditVideoModal video={video} onClose={() => setOpen(false)} onSaved={() => { setSaved(n => n + 1); setOpen(false); }} />}
  </DeleteConfirmationProvider></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
