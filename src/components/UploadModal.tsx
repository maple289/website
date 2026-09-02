import { useRef, useState } from 'react';
import { Film, Loader as Loader2, Lock, Globe, Upload, X, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { createImageVariants, createStorageId, dataUrlToBlob, isSupportedImage } from '@/lib/imageStorage';

type UploadModalProps = {
  onClose: () => void;
  onUploaded: () => void;
};

export function UploadModal({ onClose, onUploaded }: UploadModalProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [autoPreviewTried, setAutoPreviewTried] = useState(false);
  const [fileName, setFileName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const captureFirstFrame = (videoFile: File) => {
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;

    video.addEventListener('loadeddata', () => {
      // Seek slightly into the video so we don't get a black frame
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    });

    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 180;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPreviewImage(dataUrl);
      }
      URL.revokeObjectURL(url);
      setAutoPreviewTried(true);
    });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      setAutoPreviewTried(true);
    });
  };

  const handleFileSelect = (f: File) => {
    if (!f.type.startsWith('video/')) {
      setError('Please select a video file.');
      return;
    }
    setFile(f);
    setFileName(f.name.replace(/\.[^.]+$/, ''));
    setPreviewImage(null);
    setAutoPreviewTried(false);
    setError(null);
    captureFirstFrame(f);
  };

  const handlePreviewSelect = (f: File) => {
    if (!isSupportedImage(f)) {
      setError('Please select a JPEG, PNG, WebP, GIF, or AVIF preview image.');
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError('Preview images must be 25 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreviewImage(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file || !user) {
      setError('Please select a video file.');
      return;
    }
    if (!fileName.trim()) {
      setError('Please enter a video name.');
      return;
    }

    setUploading(true);
    let uploadedVideoPath: string | null = null;
    let uploadedPreviewPath: string | null = null;
    try {
      const videoId = createStorageId();
      const sourceExtension = file.name.split('.').pop()?.toLowerCase() ?? 'mp4';
      const extension = sourceExtension.replace(/[^a-z0-9]/g, '') || 'mp4';
      const storagePath = `${user.id}/videos/${videoId}/${createStorageId()}.${extension}`;

      const { error: uploadErr } = await supabase.storage
        .from('user-videos')
        .upload(storagePath, file, { contentType: file.type });

      if (uploadErr) {
        setError('Failed to upload video: ' + uploadErr.message);
        setUploading(false);
        return;
      }
      uploadedVideoPath = storagePath;

      let previewPath: string | null = null;
      if (previewImage) {
        const previewSource = await dataUrlToBlob(previewImage);
        const { preview } = await createImageVariants(previewSource);
        previewPath = `${user.id}/video-previews/${videoId}/${createStorageId()}.webp`;
        const { error: previewErr } = await supabase.storage
          .from('user-images')
          .upload(previewPath, preview, { contentType: 'image/webp' });

        if (previewErr) {
          await supabase.storage.from('user-videos').remove([storagePath]);
          uploadedVideoPath = null;
          setError('Failed to upload preview image: ' + previewErr.message);
          setUploading(false);
          return;
        }
        uploadedPreviewPath = previewPath;
      }

      const { error: dbErr } = await supabase.from('videos').insert({
        id: videoId,
        owner_id: user.id,
        owner_email: user.email ?? '',
        file_name: fileName.trim(),
        storage_path: storagePath,
        preview_url: null,
        preview_path: previewPath,
        visibility,
        file_size: file.size,
        mime_type: file.type,
      });

      if (dbErr) {
        await supabase.storage.from('user-videos').remove([storagePath]);
        if (previewPath) await supabase.storage.from('user-images').remove([previewPath]);
        uploadedVideoPath = null;
        uploadedPreviewPath = null;
        setError('Failed to save video record: ' + dbErr.message);
        setUploading(false);
        return;
      }

      onUploaded();
    } catch (err) {
      if (uploadedVideoPath) await supabase.storage.from('user-videos').remove([uploadedVideoPath]);
      if (uploadedPreviewPath) await supabase.storage.from('user-images').remove([uploadedPreviewPath]);
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]"><Film size={20} /></div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Upload Video</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[#a7a7a7] hover:bg-[#2a2a2a] hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-7 pt-5">
          {/* File drop zone */}
          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed py-12 transition ${dragOver ? 'border-[#ff3d46] bg-[#ff3d46]/5' : 'border-[#3a3a3a] hover:border-[#555]'}`}
            >
              <Upload size={36} className="mb-3 text-[#666]" />
              <p className="text-sm font-medium text-[#ccc]">Drag and drop a video here</p>
              <p className="mt-1 text-xs text-[#777]">or click to browse — MP4, WebM, MOV</p>
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-[#3a3a3a] bg-[#121212] p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ff3d46]/15 text-[#ff737b]"><Film size={18} /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-[#888]">{(file.size / (1024 * 1024)).toFixed(1)} MB · {file.type}</p>
              </div>
              <button type="button" onClick={() => { setFile(null); setFileName(''); setPreviewImage(null); setAutoPreviewTried(false); }} className="rounded-full p-2 text-[#888] hover:bg-[#272727] hover:text-white">
                <X size={16} />
              </button>
            </div>
          )}

          {file && (
            <>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Video Name</label>
              <input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="My awesome video"
                className="mb-4 h-11 w-full rounded-xl border border-[#3a3a3a] bg-[#121212] px-4 text-sm outline-none transition focus:border-[#4b86ff]"
              />

              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Preview Image</label>
              <div className="mb-4 flex items-center gap-3">
                {previewImage ? (
                  <div className="relative">
                    <img src={previewImage} alt="Preview" className="h-16 w-28 rounded-lg object-cover" />
                    <button type="button" onClick={() => setPreviewImage(null)} className="absolute -right-2 -top-2 rounded-full bg-[#ff3d46] p-1 text-white"><X size={12} /></button>
                  </div>
                ) : autoPreviewTried ? (
                  <button type="button" onClick={() => previewInputRef.current?.click()} className="flex h-16 w-28 items-center justify-center rounded-lg border-2 border-dashed border-[#3a3a3a] text-[#666] transition hover:border-[#555]">
                    <ImageIcon size={18} />
                  </button>
                ) : (
                  <div className="flex h-16 w-28 items-center justify-center rounded-lg border-2 border-dashed border-[#3a3a3a] bg-[#121212]">
                    <Loader2 size={18} className="animate-spin text-[#555]" />
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => previewInputRef.current?.click()} className="text-sm font-medium text-[#ff6971] hover:text-[#ff9ba0]">Choose image</button>
                    {file && (
                      <button type="button" onClick={() => { setAutoPreviewTried(false); setPreviewImage(null); captureFirstFrame(file); }} className="flex items-center gap-1 text-xs text-[#888] hover:text-white">
                        <RefreshCw size={12} /> Re-capture
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[#777]">Auto-generated from the first frame. You can upload a custom image instead.</p>
                </div>
                <input ref={previewInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePreviewSelect(e.target.files[0])} />
              </div>

              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Visibility</label>
              <div className="mb-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setVisibility('private')} className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${visibility === 'private' ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999] hover:border-[#4a4a4a]'}`}>
                  <Lock size={15} /> Private
                </button>
                <button type="button" onClick={() => setVisibility('public')} className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${visibility === 'public' ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999] hover:border-[#4a4a4a]'}`}>
                  <Globe size={15} /> Public
                </button>
              </div>
              <p className="mb-5 text-xs text-[#6a6a6a]">Private videos are only visible to you. Public videos appear in the public gallery for everyone.</p>
            </>
          )}

          {error && <div className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
            <button type="submit" disabled={!file || uploading} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:opacity-60">
              {uploading ? <><Loader2 size={16} className="animate-spin" /> Uploading...</> : <><Upload size={16} /> Upload</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
