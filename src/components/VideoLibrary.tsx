import { useEffect, useState } from 'react';
import { Film, Globe, Library, Loader as Loader2, Lock, Pencil, Play, Plus, Trash2, Upload, TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import { formatBytes, timeAgo } from '@/lib/types';
import { UploadModal } from '@/components/UploadModal';
import { EditVideoModal } from '@/components/EditVideoModal';
import { VideoPlayer } from '@/components/VideoPlayer';
import { StorageImage } from '@/components/StorageImage';
import { useAuth } from '@/hooks/useAuth';

export function VideoLibrary() {
  const { user } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);
  const [deletingVideo, setDeletingVideo] = useState<Video | null>(null);

  const load = async () => {
    setLoading(true);
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
  };

  useEffect(() => { load(); }, [user]);

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
    await supabase.storage.from('user-videos').remove([deletingVideo.storage_path]);
    if (deletingVideo.preview_path) await supabase.storage.from('user-images').remove([deletingVideo.preview_path]);
    setDeletingVideo(null);
    load();
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em]">My Library</h2>
          <p className="mt-1 text-sm text-[#888]">{videos.length} {videos.length === 1 ? 'video' : 'videos'} — manage your uploaded content</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
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
      ) : videos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-20 text-center">
          <Library className="mx-auto mb-3 text-[#555]" size={36} />
          <p className="text-base font-medium text-[#aaa]">Your library is empty</p>
          <p className="mt-1 text-sm text-[#888]">Upload your first video to get started.</p>
          <button onClick={() => setShowUpload(true)} className="mt-5 flex items-center gap-2 rounded-xl bg-[#ff3d46] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#ff5962] mx-auto">
            <Plus size={18} /> Upload video
          </button>
        </div>
      ) : (
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {videos.map((v) => (
            <VideoCard
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
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); load(); }} />
      )}

      {editingVideo && (
        <EditVideoModal
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
          onSaved={() => { setEditingVideo(null); load(); }}
        />
      )}

      {playingVideo && (
        <VideoPlayer video={playingVideo} onClose={() => setPlayingVideo(null)} />
      )}

      {deletingVideo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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
  );
}

function VideoCard({ video, onPlay, onEdit, onDelete }: { video: Video; onPlay: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className="group min-w-0">
      <div className="relative aspect-video cursor-pointer overflow-hidden rounded-xl bg-[#202020]" onClick={onPlay}>
        <StorageImage
          storagePath={video.preview_path}
          legacyUrl={video.preview_url}
          alt={video.file_name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          fallback={<div className="flex h-full w-full items-center justify-center text-[#555]"><Film size={36} /></div>}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ff3d46]/90 text-white"><Play size={22} fill="white" /></div>
        </div>
        <span className={`absolute bottom-2 left-2 flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold ${video.visibility === 'public' ? 'bg-emerald-500/90 text-white' : 'bg-black/85 text-[#ccc]'}`}>
          {video.visibility === 'public' ? <Globe size={11} /> : <Lock size={11} />}
          {video.visibility === 'public' ? 'Public' : 'Private'}
        </span>
      </div>
      <div className="mt-3">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-[1.45] tracking-[-0.01em] text-[#f1f1f1]">{video.file_name}</h3>
        <p className="mt-1 text-[13px] text-[#858585]">{formatBytes(video.file_size)} · {timeAgo(video.created_at)}</p>
        <div className="mt-3 flex gap-2">
          <button onClick={onEdit} className="flex items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-xs font-medium text-[#aaa] transition hover:bg-[#2a2a2a] hover:text-white">
            <Pencil size={13} /> Edit
          </button>
          <button onClick={onPlay} className="flex items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-xs font-medium text-[#aaa] transition hover:bg-[#2a2a2a] hover:text-white">
            <Play size={13} /> Play
          </button>
          <button onClick={onDelete} className="flex items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-xs font-medium text-[#aaa] transition hover:bg-[#ff3d46]/15 hover:text-[#ff737b]">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
    </article>
  );
}
