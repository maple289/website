/* eslint-disable react-refresh/only-export-components -- Isolated fixture. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '@/context/AuthContext';
import { DeleteConfirmationProvider } from '@/components/DeleteConfirmationProvider';
import { FileClipboardProvider } from '@/context/FileClipboardContext';
import { FileManager } from '@/components/FileManager';
import { MediaContentMenu } from '@/components/MediaContentMenu';
import { supabase } from '@/lib/supabase';
import type { Photo } from '@/lib/types';
import '@/index.css';
import '@/components/MediaGallery.css';
const owner = '11111111-1111-4111-8111-111111111111';
const user = { id: owner, email: 'fixture@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: 'fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, user };
supabase.auth.getSession = async () => ({ data: { session }, error: null });
const okay = async () => ({ error: null });
const auth = { user, session, loading: false, configured: true, passwordSetup: null, signIn: okay, signUp: okay, requestRegistration: okay, completeInitialPassword: okay, cancelPasswordSetup: () => {}, signOut: async () => {} };
const photo: Photo = { id: '22222222-2222-4222-8222-222222222222', owner_id: owner, owner_email: null, file_name: 'Owned photo.jpg', storage_path: `${owner}/photo.jpg`, preview_path: '', thumbnail_path: '', visibility: 'private', file_size: 100, mime_type: 'image/jpeg', width: 10, height: 10, created_at: '2026-01-01' };
function Harness() {
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(auth);
  return <AuthContext.Provider value={current}><DeleteConfirmationProvider><FileClipboardProvider>
    <button onClick={() => setCurrent({ ...auth, user: { ...user, id: '33333333-3333-4333-8333-333333333333' } })}>Switch user</button>
    <div className="media-page"><div className="mg-grid p-4"><article className="mg-card h-40"><MediaContentMenu kind="photo" item={photo} onPreview={() => {}} /><p>Owned photo</p></article><article className="mg-card h-40"><MediaContentMenu kind="photo" item={{ ...photo, id: '44444444-4444-4444-8444-444444444444', owner_id: 'another-owner', file_name: 'Other photo.jpg' }} onPreview={() => {}} /><p>Other photo</p></article></div></div>
    <FileManager key={current.user.id} searchTerm={query} onSearchTermChange={setQuery} />
  </FileClipboardProvider></DeleteConfirmationProvider></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
