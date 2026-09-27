import { VideoProcessingJobs } from '@/components/VideoProcessingJobs';
import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { deleteMedia } from '@/lib/deleteMedia';
import { FileDropArea } from '@/components/FileDropArea';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Library, Loader as Loader2, Plus, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import { UploadModal } from '@/components/UploadModal';
import { EditVideoModal } from '@/components/EditVideoModal';
import { VideoPlayer } from '@/components/VideoPlayer';
import { MediaVideoCard } from '@/components/MediaVideoCard';
import { useAuth } from '@/hooks/useAuth';

export function VideoLibrary({ searchTerm }: { searchTerm: string }) {
  const { user } = useAuth();
  const loadVersion = useRef(0);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);
  const { requestDelete, isOpen: deletingVideo } = useDeleteConfirmation();

  const load = useCallback(async (quiet = false) => {
    const version = ++loadVersion.current;
    if (!quiet) setLoading(true);
    setError(null);
    if (!user) {
      setVideos([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });
    if (version !== loadVersion.current) return;
    if (error) {
      setError('Could not load your videos.');
    } else {
      setVideos(data ?? []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while any video is still processing
  useEffect(() => {
    if (!videos.length) return;
    const interval = setInterval(() => void load(true), videos.some((v) => v.processing_status === 'processing') ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [videos, load]);

  useEffect(() => {
    const refresh = (event: Event) => { if ((event as CustomEvent).detail === 'video') void load(); };
    window.addEventListener('media-uploaded', refresh);
    return () => window.removeEventListener('media-uploaded', refresh);
  }, [load]);

  const filteredVideos = videos.filter((video) => {
    const term = searchTerm.trim().toLowerCase();
    return !term || video.file_name.toLowerCase().includes(term);
  });

  const confirmDelete = (video: Video) => {
    if (!user) return;
    void requestDelete({ title: 'Delete video', message: `Are you sure you want to delete "${video.file_name}"?`,
      details: 'The video, its stored versions, preview and reactions will be permanently deleted. This cannot be undone.',
      onConfirm: async () => {
        await deleteMedia('video', video, user.id);
        setVideos((current) => current.filter((item) => item.id !== video.id));
        await load(true);
      },
    });
  };

  return (
    <FileDropArea mediaKind="video" appearance="media" message="Drop videos here to upload" enabled={!!user && !showUpload && !editingVideo && !playingVideo && !deletingVideo} onFiles={(files) => { setDroppedFiles(files); setShowUpload(true); }}>
    <div className="mg-page">
      <div className="mg-toolbar">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em]">My Library</h2>
          <p className="mt-1 text-sm text-[#888]">{filteredVideos.length} of {videos.length} {videos.length === 1 ? 'video' : 'videos'} — manage your uploaded content</p>
        </div>
        <button
          onClick={() => { setDroppedFiles([]); setShowUpload(true); }}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] px-4 text-sm font-semibold text-white transition hover:bg-[#ff5962]"
        >
          <Upload size={18} /> Upload video
        </button>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>
      )}

      <VideoProcessingJobs searchTerm={searchTerm} visibleIds={videos.map(video => video.id)} />

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={26} className="animate-spin text-[#ff3d46]" /></div>
      ) : filteredVideos.length === 0 ? (
        <div className="mg-empty rounded-2xl border border-dashed py-20 text-center">
          <Library className="mx-auto mb-3 text-[#555]" size={36} />
          <p className="text-base font-medium text-[#aaa]">{searchTerm ? 'No matching videos' : 'Your library is empty'}</p>
          <p className="mt-1 text-sm text-[#888]">{searchTerm ? 'Try a different search.' : 'Upload your first video to get started.'}</p>
          {!searchTerm && <button onClick={() => { setDroppedFiles([]); setShowUpload(true); }} className="mt-5 flex items-center gap-2 rounded-xl bg-[#ff3d46] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#ff5962] mx-auto"><Plus size={18} /> Upload video</button>}
        </div>
      ) : (
        <div className="mg-grid">
          {filteredVideos.map((v) => (
            <MediaVideoCard
              key={v.id}
              video={v}
              onPlay={() => setPlayingVideo(v)}
              onEdit={() => setEditingVideo(v)}
              onDelete={() => confirmDelete(v)}
            />
          ))}
        </div>
      )}

      {showUpload && (
        <div className="mg-dialog"><UploadModal initialFiles={droppedFiles} onItemUploaded={() => void load()} onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); load(); }} /></div>
      )}

      {editingVideo && (
        <div className="mg-dialog"><EditVideoModal
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
          onSaved={() => { setEditingVideo(null); load(); }}
        /></div>
      )}

      {playingVideo && (
        <VideoPlayer video={playingVideo} onClose={() => setPlayingVideo(null)} />
      )}


    </div>
    </FileDropArea>
  );
}
