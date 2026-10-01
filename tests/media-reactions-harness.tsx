/* eslint-disable react-refresh/only-export-components -- Standalone browser regression entry. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { MediaReactions } from '@/components/MediaReactions';
import { MediaVideoCard } from '@/components/MediaVideoCard';
import { VideoPlayer } from '@/components/VideoPlayer';
import { PhotoViewer } from '@/components/PhotoViewer';
import { DeleteConfirmationProvider } from '@/components/DeleteConfirmationProvider';
import { ReactionContext, ReactionStore } from '@/lib/reactions';
import { supabase } from '@/lib/supabase';
import type { Photo, Video } from '@/lib/types';
import '@/index.css';
import '@/components/FluentTheme.css';
import '@/components/MediaGallery.css';

const userId = '11111111-1111-4111-8111-111111111111';
const guest = new URLSearchParams(location.search).has('guest');
const session = guest ? null : { access_token: 'fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600,
  user: { id: userId, email: 'fixture@example.test' } } as Session;
supabase.auth.getSession = async () => ({ data: { session }, error: null });
const store = new ReactionStore(guest ? null : userId);
const video: Video = {
  id: '22222222-2222-4222-8222-222222222222', owner_id: userId, owner_email: null, file_name: 'Mountain weekend.mp4',
  storage_path: 'fixture/video.mp4', preview_url: '/tests/reaction-poster.svg', preview_path: null, visibility: 'public', file_size: 24300000,
  mime_type: 'video/mp4', created_at: new Date().toISOString(), processing_status: 'ready', processed_storage_path: null, processing_error: null,
  video_codec: 'h264', video_bitrate: 2500000, resolution_width: 1920, resolution_height: 1080, frame_rate: 30, duration_seconds: 88, container_format: 'mp4',
};
const photos: Photo[] = [0, 1].map(index => ({
  id: `33333333-3333-4333-8333-33333333333${index}`, owner_id: userId, owner_email: null,
  file_name: index ? 'Next landscape.jpg' : 'Mountain landscape.jpg', storage_path: `fixture/photo-${index}.svg`, preview_path: `fixture/photo-${index}.svg`,
  thumbnail_path: `fixture/photo-${index}.svg`, visibility: 'public', file_size: 120000, mime_type: 'image/jpeg', width: 640, height: 480, created_at: new Date().toISOString(),
}));
function Harness() {
  const [viewer, setViewer] = useState<'video' | 'photo' | null>(null);
  useEffect(() => { store.start(); return () => store.stop(); }, []);
  return <div className="fluent-app"><DeleteConfirmationProvider><ReactionContext.Provider value={store}>
    <main className="media-page"><header style={{ background: '#182c49', color: '#fff', padding: '20px 24px', fontSize: 20, fontWeight: 650 }}>MyHostage</header>
      <section className="mg-page" style={{ maxWidth: 850 }}><div className="mg-toolbar"><div><p className="mg-eyebrow">Layout preview</p><h1>Compact reactions</h1></div></div>
        <div className="mg-grid" data-density="compact">
          <MediaVideoCard video={video} onPlay={() => setViewer('video')} showOwner />
          <article className="mg-card" data-testid="photo-card" onClick={() => setViewer('photo')}>
            <button className="mg-thumbnail" aria-label="Open Mountain landscape.jpg"><img className="mg-image" src="/tests/reaction-poster.svg" alt="Mountain landscape"/><span className="mg-badge mg-privacy public">Public</span></button>
            <div className="mg-card-body"><h3 className="mg-title">Mountain landscape.jpg</h3><p className="mg-meta">Just now</p><MediaReactions mediaType="photo" mediaId={photos[0].id} mediaName={photos[0].file_name} /></div>
          </article>
        </div>
      </section>
    </main>
    {viewer === 'video' && <VideoPlayer video={video} onClose={() => setViewer(null)} />}
    {viewer === 'photo' && <PhotoViewer photos={photos} startIndex={0} onClose={() => setViewer(null)} />}
  </ReactionContext.Provider></DeleteConfirmationProvider></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
