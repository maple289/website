import * as tus from 'tus-js-client';
import { supabase } from '@/lib/supabase';
import { createImageVariants, createStorageId, dataUrlToBlob, fileExtension, isSupportedImage } from '@/lib/imageStorage';
import { fetchStorageBasePath } from '@/lib/storageSettings';
type Options = { file: File; user: { id: string; email?: string }; fileName: string; visibility: 'private' | 'public'; onProgress: (value: number) => void; previewImage?: string | null };

export async function uploadObject(bucket: string, path: string, file: Blob, mimeType: string, onProgress: (value: number) => void): Promise<{ error: { message: string } | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: { message: 'Please sign in again to upload.' } };
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`);
    request.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    request.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');
    request.setRequestHeader('Content-Type', mimeType || 'application/octet-stream');
    request.setRequestHeader('x-upsert', 'false');
    request.setRequestHeader('cache-control', 'max-age=3600');
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve({ error: null });
      else {
        let message = `Upload failed (${request.status}).`;
        try { message = JSON.parse(request.responseText).message || message; } catch { /* Keep safe fallback. */ }
        resolve({ error: { message } });
      }
    };
    request.onerror = () => resolve({ error: { message: 'Network error. Please try again.' } });
    request.timeout = 300000;
    request.ontimeout = () => resolve({ error: { message: 'Upload timed out. Please try again.' } });
    request.send(file);
  });
}

export function captureVideoPreview(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let finished = false;
    const finish = (preview: string | null) => {
      if (finished) return;
      finished = true; window.clearTimeout(timer); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); resolve(preview);
    };
    const timer = window.setTimeout(() => finish(null), 10000);
    video.muted = true; video.preload = 'auto';
    video.onloadeddata = () => { video.currentTime = Math.min(0.1, (video.duration || 1) / 2); };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth || 320; canvas.height = video.videoHeight || 180;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.8));
      } catch { finish(null); }
    };
    video.onerror = () => finish(null); video.src = url;
  });
}
export async function uploadVideo({ file, user, fileName, visibility, onProgress, previewImage }: Options) {
  if (!fileName.trim()) throw new Error('Please enter a video name.');
  if (!file.type.startsWith('video/')) throw new Error('Please select a supported video file.');
    let uploadedVideoPath: string | null = null;
    let uploadedPreviewPath: string | null = null;
    try {
      const videoId = createStorageId();
      const fileId = createStorageId();
      const sourceExtension = file.name.split('.').pop()?.toLowerCase() ?? 'mp4';
      const extension = sourceExtension.replace(/[^a-z0-9]/g, '') || 'mp4';
      const videosBase = await fetchStorageBasePath('videos');
      const pathPrefix = videosBase ? `${videosBase}/` : '';
      const storagePath = `${user.id}/videos/${videoId}/${fileId}.${extension}`;
      const bucketPath = `${pathPrefix}${storagePath}`;

      const mimeType = file.type || guessMimeType(extension);

      if (file.size > 50 * 1024 * 1024) {
        await uploadLargeFile(file, bucketPath, mimeType, (pct) => onProgress(Math.round(pct * 0.85)));
      } else {
        const { error: uploadErr } = await uploadObject('user-videos', bucketPath, file, mimeType, (pct) => onProgress(Math.round(pct * 0.85)));

        if (uploadErr) {
          console.error('Video upload failed:', uploadErr);
          throw new Error(uploadErr.message || 'Could not upload video.');
        }
      }
      onProgress(85);
      uploadedVideoPath = bucketPath;

      let previewPath: string | null = null;
      let previewBucketPath: string | null = null;
      if (previewImage) {
        const previewSource = await dataUrlToBlob(previewImage);
        const { preview } = await createImageVariants(previewSource);
        const imagesBase = await fetchStorageBasePath('images');
        const imgPrefix = imagesBase ? `${imagesBase}/` : '';
        previewPath = `${user.id}/video-previews/${videoId}/${createStorageId()}.webp`;
        previewBucketPath = `${imgPrefix}${previewPath}`;
        const { error: previewErr } = await supabase.storage
          .from('user-images')
          .upload(previewBucketPath, preview, { contentType: 'image/webp' });

        if (previewErr) {
          await supabase.storage.from('user-videos').remove([bucketPath]);
          uploadedVideoPath = null;
          console.error('Preview upload failed:', previewErr);
          throw new Error('Could not upload preview image.');
        }
        uploadedPreviewPath = previewBucketPath;
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
        mime_type: mimeType,
        processing_status: 'ready',
      });

      if (dbErr) {
        await supabase.storage.from('user-videos').remove([bucketPath]);
        if (previewBucketPath) await supabase.storage.from('user-images').remove([previewBucketPath]);
        uploadedVideoPath = null;
        uploadedPreviewPath = null;
        console.error('Saving the video record failed:', dbErr);
        throw new Error(dbErr.message || 'Could not save video.');
      }

      onProgress(100);
    } catch (err: unknown) {
      if (uploadedVideoPath) await supabase.storage.from('user-videos').remove([uploadedVideoPath]);
      if (uploadedPreviewPath) await supabase.storage.from('user-images').remove([uploadedPreviewPath]);
      console.error('Upload failed:', err);
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      throw new Error(msg);
    }
}
export async function uploadPhoto({ file, user, fileName, visibility, onProgress }: Options) {
  if (!fileName.trim()) throw new Error('Please enter a photo name.');
  if (!isSupportedImage(file)) throw new Error('Please select a JPEG, PNG, WebP, GIF, or AVIF image.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Images must be 25 MB or smaller.');
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
      const { error: originalError } = await uploadObject('user-images', originalUploadPath, file, file.type, (pct) => onProgress(Math.round(pct * 0.7)));
      if (originalError) {
        console.error('Original photo upload failed:', originalError);
        throw new Error(originalError.message || 'We could not upload that photo. Please try again.');
      }
      onProgress(70);
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

      onProgress(95);
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

      onProgress(100);
      return variantWarning;
    } catch (uploadError) {
      if (uploadedPaths.length > 0) await supabase.storage.from('user-images').remove(uploadedPaths);
      console.error('Photo upload failed:', uploadError);
      const msg = uploadError instanceof Error ? uploadError.message : 'We could not upload that photo. Please check the file and try again.';
      throw new Error(msg);
    }
}
async function uploadLargeFile(
  file: File,
  bucketPath: string,
  mimeType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('You must be signed in to upload.');

  const parsedSupabaseUrl = new URL(supabaseUrl);
  const storageEndpoint = parsedSupabaseUrl.hostname.endsWith('.supabase.co')
    ? `https://${parsedSupabaseUrl.hostname.split('.')[0]}.storage.supabase.co/storage/v1/upload/resumable`
    : new URL('/storage/v1/upload/resumable', parsedSupabaseUrl).toString();

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: storageEndpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: anonKey,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: 'user-videos',
        objectName: bucketPath,
        contentType: mimeType,
        cacheControl: '3600',
      },
      onError: (error) => reject(error),
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.(Math.round((bytesUploaded / bytesTotal) * 100));
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    m4v: 'video/x-m4v',
    ogv: 'video/ogg',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    '3gp': 'video/3gpp',
  };
  return map[ext] ?? 'video/mp4';
}
