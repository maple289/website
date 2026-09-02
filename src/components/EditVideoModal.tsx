import { useEffect, useRef, useState } from 'react';
import { Film, Globe, Image as ImageIcon, Loader2, Lock, Pencil, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import { getPlayableUrl } from '@/lib/types';
import { createImageVariants, createStorageId, dataUrlToBlob, isSupportedImage } from '@/lib/imageStorage';
import { StorageImage } from '@/components/StorageImage';

type EditVideoModalProps = {
  video: Video;
  onClose: () => void;
  onSaved: () => void;
};

export function EditVideoModal({ video, onClose, onSaved }: EditVideoModalProps) {
  const [fileName, setFileName] = useState(video.file_name);
  const [previewUrl, setPreviewUrl] = useState<string | null>(video.preview_url);
  const [previewChanged, setPreviewChanged] = useState(false);
  const [visibility, setVisibility] = useState<'private' | 'public'>(video.visibility);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showCapture || videoUrl) return;
    let active = true;
    setVideoLoading(true);
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const url = await getPlayableUrl(video.id, token);
      if (active) {
        setVideoUrl(url);
        setVideoLoading(false);
      }
    })();
    return () => { active = false; };
  }, [showCapture, video.id, videoUrl]);

  const captureFrame = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 320;
    canvas.height = vid.videoHeight || 180;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setPreviewUrl(dataUrl);
    setPreviewChanged(true);
    setShowCapture(false);
  };

  const handlePreviewUpload = (f: File) => {
    if (!isSupportedImage(f)) {
      setError('Please select a JPEG, PNG, WebP, GIF, or AVIF image.');
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError('Preview images must be 25 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result as string);
      setPreviewChanged(true);
    };
    reader.readAsDataURL(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fileName.trim()) {
      setError('Video name cannot be empty.');
      return;
    }

    setSaving(true);
    let uploadedPreviewPath: string | null = null;
    let nextPreviewPath = video.preview_path;

    if (previewChanged && previewUrl) {
      try {
        const previewSource = await dataUrlToBlob(previewUrl);
        const { preview } = await createImageVariants(previewSource);
        nextPreviewPath = `${video.owner_id}/video-previews/${video.id}/${createStorageId()}.webp`;
        const { error: uploadError } = await supabase.storage
          .from('user-images')
          .upload(nextPreviewPath, preview, { contentType: 'image/webp' });
        if (uploadError) {
          setError('Failed to upload preview image: ' + uploadError.message);
          setSaving(false);
          return;
        }
        uploadedPreviewPath = nextPreviewPath;
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Failed to process preview image.');
        setSaving(false);
        return;
      }
    } else if (previewChanged) {
      nextPreviewPath = null;
    }

    const { error } = await supabase
      .from('videos')
      .update({
        file_name: fileName.trim(),
        preview_url: previewChanged ? null : previewUrl,
        preview_path: nextPreviewPath,
        visibility,
      })
      .eq('id', video.id);

    if (error) {
      if (uploadedPreviewPath) await supabase.storage.from('user-images').remove([uploadedPreviewPath]);
      setError('Failed to save changes: ' + error.message);
      setSaving(false);
      return;
    }
    if (previewChanged && video.preview_path && video.preview_path !== nextPreviewPath) {
      await supabase.storage.from('user-images').remove([video.preview_path]);
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]"><Pencil size={20} /></div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Edit Video</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[#a7a7a7] hover:bg-[#2a2a2a] hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-7 pt-5">
          {/* Preview image section */}
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Preview Image</label>
          <div className="mb-4 flex gap-3">
            <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212]">
              <StorageImage
                storagePath={previewChanged ? null : video.preview_path}
                legacyUrl={previewUrl}
                alt="Preview"
                className="h-full w-full object-cover"
                fallback={<div className="flex h-full w-full items-center justify-center text-[#555]"><ImageIcon size={24} /></div>}
              />
              {(previewUrl || (!previewChanged && video.preview_path)) && (
                <button type="button" onClick={() => { setPreviewUrl(null); setPreviewChanged(true); }} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X size={12} /></button>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-lg border border-[#3a3a3a] px-3 py-2 text-xs font-medium text-[#ccc] transition hover:bg-[#272727]">
                <Upload size={14} /> Upload image
              </button>
              <button type="button" onClick={() => setShowCapture(!showCapture)} className="flex items-center gap-2 rounded-lg border border-[#3a3a3a] px-3 py-2 text-xs font-medium text-[#ccc] transition hover:bg-[#272727]">
                <Film size={14} /> Capture from video
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePreviewUpload(e.target.files[0])} />
            </div>
          </div>

          {showCapture && (
            <div className="mb-4 rounded-xl border border-[#3a3a3a] bg-[#121212] p-3">
              {videoLoading ? (
                <div className="flex h-40 items-center justify-center"><Loader2 size={24} className="animate-spin text-[#ff3d46]" /></div>
              ) : videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    className="mb-2 w-full rounded-lg"
                    preload="metadata"
                  />
                  <p className="mb-2 text-xs text-[#888]">Play the video and pause at the frame you want, then click capture.</p>
                  <button type="button" onClick={captureFrame} className="rounded-lg bg-[#ff3d46] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff5962]">Capture current frame</button>
                </>
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-[#888]">Unable to load video for capture.</div>
              )}
            </div>
          )}

          {/* Video name */}
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Video Name</label>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="mb-4 h-11 w-full rounded-xl border border-[#3a3a3a] bg-[#121212] px-4 text-sm outline-none transition focus:border-[#4b86ff]"
            placeholder="Video name"
          />

          {/* Visibility */}
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Visibility</label>
          <div className="mb-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setVisibility('private')} className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${visibility === 'private' ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999] hover:border-[#4a4a4a]'}`}>
              <Lock size={15} /> Private
            </button>
            <button type="button" onClick={() => setVisibility('public')} className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${visibility === 'public' ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999] hover:border-[#4a4a4a]'}`}>
              <Globe size={15} /> Public
            </button>
          </div>

          {error && <div className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
            <button type="submit" disabled={saving} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:opacity-60">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
