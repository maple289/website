import { useCallback, useEffect, useState } from 'react';
import { Film, FolderOpen, Image as ImageIcon, Loader as Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { MediaVideoCard } from '@/components/MediaVideoCard';
import { PublicPhotoGallery } from '@/components/PublicPhotoGallery';

type Tab = 'videos' | 'photos';

type HomePageProps = {
  tab: Tab;
  searchTerm: string;
  onTabChange: (tab: Tab) => void;
  onFiles: () => void;
};

export function HomePage({ tab, searchTerm, onTabChange, onFiles }: HomePageProps) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false });
    if (!error) setVideos(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = (event: Event) => { if ((event as CustomEvent).detail === 'video') void load(); };
    window.addEventListener('media-uploaded', refresh);
    return () => window.removeEventListener('media-uploaded', refresh);
  }, [load]);

  // Auto-refresh while any public video is still processing
  useEffect(() => {
    if (!videos.length) return;
    const interval = setInterval(() => void load(true), videos.some((v) => v.processing_status === 'processing') ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [videos, load]);

  const filtered = videos.filter((v) => {
    const term = searchTerm.trim().toLowerCase();
    return !term || v.file_name.toLowerCase().includes(term) || (v.owner_email ?? '').toLowerCase().includes(term);
  });

  return (
    <div className="mg-page">
      {/* Tab switcher */}
      <MediaTabs active={tab} onSelect={(value) => value === 'files' ? onFiles() : onTabChange(value)} />

      {tab === 'videos' ? (
        <section className="py-5">
          <div className="mg-toolbar">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#ff6971]">Public Gallery</p>
            <h1 className="text-[27px] font-semibold tracking-[-0.04em] sm:text-[34px]">Discover videos</h1>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[#ff3d46]" /></div>
          ) : filtered.length === 0 ? (
            <div className="mg-empty rounded-2xl border border-dashed py-24 text-center">
              <Film className="mx-auto mb-4 text-[#707070]" size={40} />
              <p className="text-lg font-medium">{searchTerm ? 'No matching videos' : 'No public videos yet'}</p>
              <p className="mt-2 text-sm text-[#888]">{searchTerm ? 'Try a different search term.' : 'Videos marked as public by users will appear here.'}</p>
            </div>
          ) : (
            <div className="mg-grid">
              {filtered.map((v) => (
                <MediaVideoCard key={v.id} video={v} showOwner onPlay={() => setPlayingVideo(v)} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <PublicPhotoGallery searchTerm={searchTerm} />
      )}

      {playingVideo && (
        <VideoPlayer video={playingVideo} onClose={() => setPlayingVideo(null)} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition ${active ? 'border-[#ff3d46] text-white' : 'border-transparent text-[#9a9a9a] hover:text-white'}`}
    >
      {icon}
      {label}
    </button>
  );
}

export function MediaTabs({ active, onSelect }: { active: Tab | 'files'; onSelect: (tab: Tab | 'files') => void }) {
  return <nav aria-label="Media navigation" className="mg-tabs flex gap-1 border-b border-[#1a2a4a] pt-6">
    <TabButton active={active === 'videos'} onClick={() => onSelect('videos')} icon={<Film size={18} />} label="Videos" />
    <TabButton active={active === 'photos'} onClick={() => onSelect('photos')} icon={<ImageIcon size={18} />} label="Photos" />
    <TabButton active={active === 'files'} onClick={() => onSelect('files')} icon={<FolderOpen size={18} />} label="Files" />
  </nav>;
}
