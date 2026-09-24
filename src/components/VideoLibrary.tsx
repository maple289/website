import { FileDropArea } from '@/components/FileDropArea';
import { useCallback, useEffect, useState } from 'react';
import { Library, Loader as Loader2, Plus, Trash2, Upload, TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import { UploadModal } from '@/components/UploadModal';
import { EditVideoModal } from '@/components/EditVideoModal';
import { VideoPlayer } from '@/components/VideoPlayer';
import { MediaVideoCard } from '@/components/MediaVideoCard';
import { useAuth } from '@/hooks/useAuth';
import { resolveBucketPath } from '@/lib/storageSettings';

export function VideoLibrary({ searchTerm }: { searchTerm: string }) {
  const { user } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);
  const [deletingVideo, setDeletingVideo] = useState<Video | null>(null);

  const load = useCallback(async (quiet = false) => {
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

  const confirmDelete = async () => {
    if (!deletingVideo) return;
    const { error: dbErr } = await supabase
      .from('videos')
      .delete()
      .eq('id', deletingVideo.id);
    if (dbErr) {
      setError('Failed to delete video.');
      return;
    }
    const pathsToRemove = [await resolveBucketPath(deletingVideo.storage_path, 'videos')];
    if (deletingVideo.processed_storage_path && deletingVideo.processed_storage_path !== deletingVideo.storage_path) {
      pathsToRemove.push(await resolveBucketPath(deletingVideo.processed_storage_path, 'videos'));
    }
    await supabase.storage.from('user-videos').remove(pathsToRemove);
    if (deletingVideo.preview_path) await supabase.storage.from('user-images').remove([await resolveBucketPath(deletingVideo.preview_path, 'images')]);
    setDeletingVideo(null);
    load();
  };

  return (
    <FileDropArea appearance="media" message="Drop videos here to upload" enabled={!!user && !showUpload && !editingVideo && !playingVideo && !deletingVideo} onFiles={(files) => { setDroppedFiles(files); setShowUpload(true); }}>
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
              onDelete={() => setDeletingVideo(v)}
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

      {deletingVideo && (
        <div className="mg-dialog fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDeletingVideo(null)} />
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
            <div className="px-6 pt-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]"><AlertTriangle size={24} /></div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Delete Video</h2>
              <p className="mt-2 text-sm leading-6 text-[#a5a5a5]">Are you sure you want to permanently delete <span className="font-semibold text-white">{deletingVideo.file_name}</span>? This cannot be undone.</p>
            </div>
            <div className="px-6 pb-7 pt-5">
              <div className="flex gap-3">
                <button onClick={() => setDeletingVideo(null)} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
                <button onClick={confirmDelete} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-sm font-semibold text-white transition hover:bg-[#ff5962]">
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </FileDropArea>
  );
}
