import { useGalleryView } from '@/hooks/useGalleryView';
import { useEffect, useState } from 'react';
import { Film, FolderOpen, Image as ImageIcon, Loader as Loader2 } from 'lucide-react';
import type { Video } from '@/lib/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { MediaVideoCard } from '@/components/MediaVideoCard';
import { PublicPhotoGallery } from '@/components/PublicPhotoGallery';
import { GalleryError, GalleryToolbar } from '@/components/GalleryToolbar';
import { useDiscoveryMedia } from '@/hooks/useDiscoveryMedia';
import type { MediaGroup } from '@/hooks/useMediaGroups';
import { VideoProcessingJobs } from '@/components/VideoProcessingJobs';

type Tab = 'videos' | 'photos';

type HomePageProps = {
  tab: Tab;
  searchTerm: string;
  group?: MediaGroup | null;
};

export function HomePage({ tab, searchTerm, group }: HomePageProps) {
  const { items: videos, loading, error, load } = useDiscoveryMedia<Video>('video', group?.id, tab === 'videos');
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);
  useEffect(() => {
    if (playingVideo && !loading && !videos.some(video => video.id === playingVideo.id)) setPlayingVideo(null);
  }, [videos, loading, playingVideo]);

  // Auto-refresh while any public video is still processing
  useEffect(() => {
    if (tab !== 'videos' || !videos.some((v) => v.processing_status === 'processing')) return;
    const interval = setInterval(() => void load(true), 5000);
    return () => clearInterval(interval);
  }, [videos, load, tab]);

  const view = useGalleryView(videos, searchTerm);
  const filtered = view.visible;

  return (
    <div className="mg-page">
      {tab === 'videos' ? (
        <section className="py-5">
          <GalleryToolbar title="Discover videos" scope={group ? `Group: ${group.name}` : 'Public Library'} subtitle={group ? `Videos shared with ${group.name}.` : 'Explore videos shared with everyone.'} view={view} />
          {error && <GalleryError message={error} onRetry={() => void load()} />}
          {group && <VideoProcessingJobs key={group.id} groupId={group.id} searchTerm={searchTerm} visibleIds={videos.map(video => video.id)} />}

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[#ff3d46]" /></div>
          ) : !error && filtered.length === 0 ? (
            <div className="mg-empty rounded-2xl border border-dashed py-24 text-center">
              <Film className="mx-auto mb-4 text-[#707070]" size={40} />
              <p className="text-lg font-medium">{searchTerm ? 'No matching videos' : group ? 'No videos shared with this group yet' : 'No public videos yet'}</p>
              <p className="mt-2 text-sm text-[#888]">{searchTerm ? 'Try a different search term.' : group ? 'Videos assigned to this group will appear here.' : 'Videos marked as public by users will appear here.'}</p>
            </div>
          ) : (
            <div className="mg-grid" data-density={view.density}>
              {filtered.map((v) => (
                <MediaVideoCard key={v.id} video={v} showOwner onPlay={() => setPlayingVideo(v)} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <PublicPhotoGallery searchTerm={searchTerm} group={group} />
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

export function MediaTabs({ active, onSelect }: { active?: Tab | 'files'; onSelect: (tab: Tab | 'files') => void }) {
  return <nav aria-label="Media navigation" className="mg-tabs flex gap-1 border-b border-[#1a2a4a] pt-6">
    <TabButton active={active === 'videos'} onClick={() => onSelect('videos')} icon={<Film size={18} />} label="Videos" />
    <TabButton active={active === 'photos'} onClick={() => onSelect('photos')} icon={<ImageIcon size={18} />} label="Photos" />
    <TabButton active={active === 'files'} onClick={() => onSelect('files')} icon={<FolderOpen size={18} />} label="Files" />
  </nav>;
}
