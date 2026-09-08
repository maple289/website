import { useEffect, useRef, useState } from 'react';
import { Globe, Image as ImageIcon, Loader2, Lock, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { createImageVariants, createStorageId, fileExtension, isSupportedImage } from '@/lib/imageStorage';
import { fetchStorageBasePath } from '@/lib/storageSettings';

type PhotoUploadModalProps = {
  onClose: () => void;
  onUploaded: () => void;
};

export function PhotoUploadModal({ onClose, onUploaded }: PhotoUploadModalProps) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectFile = (selectedFile: File) => {
    if (!isSupportedImage(selectedFile)) {
      setError('Please select a JPEG, PNG, WebP, GIF, or AVIF image.');
      return;
    }
    if (selectedFile.size > 25 * 1024 * 1024) {
      setError('Images must be 25 MB or smaller.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result as string);
    reader.readAsDataURL(selectedFile);
    setFile(selectedFile);
    setFileName(selectedFile.name.replace(/\.[^.]+$/, ''));
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !user) return;
    if (!fileName.trim()) {
      setError('Please enter a photo name.');
      return;
    }

    setUploading(true);
    const uploadedPaths: string[] = [];

    try {
      const photoId = createStorageId();
      const imagesBase = await fetchStorageBasePath('images');
      const pathPrefix = imagesBase ? `${imagesBase}/` : '';
      const dbBasePath = `${user.id}/photos/${photoId}`;
      const bucketBasePath = `${pathPrefix}${dbBasePath}`;
      const storagePath = `${dbBasePath}/original.${fileExtension(file)}`;

      // Upload the original first — this must always succeed
      const originalUploadPath = `${bucketBasePath}/original.${fileExtension(file)}`;
      const { error: originalError } = await supabase.storage
        .from('user-images')
        .upload(originalUploadPath, file, { contentType: file.type });
      if (originalError) {
        console.error('Original photo upload failed:', originalError);
        throw new Error(originalError.message || 'We could not upload that photo. Please try again.');
      }
      uploadedPaths.push(originalUploadPath);

      // Generate preview/thumbnail variants — failure here is non-fatal
      let previewPath: string | null = null;
      let thumbnailPath: string | null = null;
      let width: number | null = null;
      let height: number | null = null;
      let variantWarning: string | null = null;

      try {
        const variants = await createImageVariants(file);
        width = variants.width;
        height = variants.height;

        const variantFiles = [
          { path: `${bucketBasePath}/preview.webp`, body: variants.preview, contentType: 'image/webp' },
          { path: `${bucketBasePath}/thumbnail.webp`, body: variants.thumbnail, contentType: 'image/webp' },
        ];

        for (const item of variantFiles) {
          const { error: variantError } = await supabase.storage
            .from('user-images')
            .upload(item.path, item.body, { contentType: item.contentType });
          if (variantError) {
            console.error('Variant upload failed:', variantError);
            throw new Error('variant-upload-failed');
          }
          uploadedPaths.push(item.path);
        }

        previewPath = `${dbBasePath}/preview.webp`;
        thumbnailPath = `${dbBasePath}/thumbnail.webp`;
      } catch (variantError) {
        console.error('Thumbnail generation failed (non-fatal):', variantError);
        variantWarning = 'Your photo was uploaded, but the preview thumbnail could not be generated. The original is preserved.';
      }

      const { error: databaseError } = await supabase.from('photos').insert({
        id: photoId,
        owner_id: user.id,
        owner_email: user.email ?? '',
        file_name: fileName.trim(),
        storage_path: storagePath,
        preview_path: previewPath,
        thumbnail_path: thumbnailPath,
        visibility,
        file_size: file.size,
        mime_type: file.type,
        width,
        height,
      });

      if (databaseError) {
        console.error('Saving the photo record failed:', databaseError);
        throw new Error(databaseError.message || 'Failed to save photo record.');
      }

      if (variantWarning) {
        // Upload succeeded but variants failed — close modal and inform via onUploaded
        onUploaded();
      } else {
        onUploaded();
      }
    } catch (uploadError) {
      if (uploadedPaths.length > 0) await supabase.storage.from('user-images').remove(uploadedPaths);
      console.error('Photo upload failed:', uploadError);
      const msg = uploadError instanceof Error ? uploadError.message : 'We could not upload that photo. Please check the file and try again.';
      setError(msg);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]"><ImageIcon size={20} /></div>
            <h2 className="text-lg font-semibold">Upload Photo</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[#a7a7a7] hover:bg-[#2a2a2a] hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} action="#" className="px-6 pb-7 pt-5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-52 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-[#3a3a3a] bg-[#121212] hover:border-[#555]"
          >
            {previewUrl ? <img src={previewUrl} alt="Selected" className="max-h-72 w-full object-contain" /> : (
              <div className="text-center text-[#777]"><Upload className="mx-auto mb-3" size={32} /><p className="text-sm">Choose an image</p><p className="mt-1 text-xs">JPEG, PNG, WebP, GIF, AVIF · up to 25 MB</p></div>
            )}
          </button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const f = event.target.files?.[0]; if (f) selectFile(f); event.target.value = ''; }} />

          {file && (
            <>
              <label className="mb-2 mt-5 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Photo Name</label>
              <input value={fileName} onChange={(event) => setFileName(event.target.value)} className="mb-4 h-11 w-full rounded-xl border border-[#3a3a3a] bg-[#121212] px-4 text-sm outline-none focus:border-[#4b86ff]" />
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Visibility</label>
              <div className="mb-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setVisibility('private')} className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium ${visibility === 'private' ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999]'}`}><Lock size={15} /> Private</button>
                <button type="button" onClick={() => setVisibility('public')} className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium ${visibility === 'public' ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999]'}`}><Globe size={15} /> Public</button>
              </div>
            </>
          )}

          {error && <div className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] hover:bg-[#272727]">Cancel</button>
            <button type="submit" disabled={!file || uploading} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-sm font-semibold text-white disabled:opacity-60">
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
