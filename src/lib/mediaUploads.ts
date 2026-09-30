import * as tus from 'tus-js-client';
import { supabase } from '@/lib/supabase';
import { dataUrlToBlob } from '@/lib/imageStorage';
import { validateMediaFile } from '@/lib/mediaValidation';
import { uploadFailureMessage } from '@/lib/uploadErrors';
type Options = { file: File; user: { id: string; email?: string }; fileName: string; visibility: 'private' | 'public'; onProgress: (value: number) => void; previewImage?: string | null; onPhase?: (phase: 'Validating' | 'Uploading' | 'Processing') => void };

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
        const message = uploadFailureMessage(request.status);
        resolve({ error: { message } });
      }
    };
    request.onerror = () => resolve({ error: { message: uploadFailureMessage() } });
    request.timeout = 300000;
    request.ontimeout = () => resolve({ error: { message: uploadFailureMessage(0, true) } });
    request.onabort = () => resolve({ error: { message: 'Upload was cancelled before completion.' } });
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
async function validatedUpload(options: Options, kind: 'video' | 'photo' | 'preview', targetVideoId?: string): Promise<{ id?: string; path?: string }> {
  const { file, user, fileName, visibility, onProgress, onPhase } = options;
  if (!fileName.trim()) throw new Error('Please enter a file name.');
  onPhase?.('Validating');
  await validateMediaFile(file, kind === 'video' ? 'video' : 'photo');
  const previewBlob = options.previewImage && kind === 'video' ? await dataUrlToBlob(options.previewImage) : null;
  if (previewBlob) await validateMediaFile(new File([previewBlob], 'preview.webp', { type: previewBlob.type }), 'photo');
  const id = crypto.randomUUID();
  const prefix = user.id + '/' + id;
  let queued = false;
  let enqueueAttempted = false;
  const paths: string[] = [];
  try {
    onPhase?.('Uploading');
    if (file.size > 6 * 1024 * 1024) await uploadLargeFile(file, prefix + '/source', file.type, pct => onProgress(Math.round(pct*.9)));
    else {
      const { error } = await uploadObject('media-staging', prefix + '/source', file, file.type, pct => onProgress(Math.round(pct*.9)));
      if (error) throw new Error(error.message);
    }
    paths.push(prefix + '/source');
    if (previewBlob) {
      const { error } = await uploadObject('media-staging', prefix + '/preview', previewBlob, previewBlob.type, () => {});
      if (error) throw new Error(error.message);
      paths.push(prefix + '/preview');
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Please sign in again to upload.');
    enqueueAttempted = true;
    const response = await fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/queue-media-upload', {
      method: 'POST', headers: { 'Content-Type':'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '', Authorization:'Bearer '+session.access_token },
      body: JSON.stringify({ id, kind, file_name:fileName.trim(), visibility, has_preview:!!options.previewImage, target_video_id:targetVideoId }),
    });
    // An ambiguous network failure may have queued the job. Never remove its
    // input unless the backend explicitly rejected it.
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status < 500) enqueueAttempted = false; throw new Error(result.error || 'Could not start media validation.'); }
    queued = true;
    onProgress(95); onPhase?.('Processing');
    if (kind === 'video') {
      window.dispatchEvent(new CustomEvent('media-processing', { detail: 'video' }));
      return { id }; // Durable server job continues after the dialog/page closes.
    }
    const deadline = Date.now() + 2 * 60 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve,1500));
      const {data,error} = await supabase.from('media_upload_jobs').select('status,error,result').eq('id',id).single();
      if (error) throw new Error('Upload received, but processing status is unavailable. Check your gallery before retrying.');
      if (data.status === 'error') throw new Error(data.error || 'This file could not be decoded.');
      if (data.status === 'complete') { onProgress(100); return data.result ?? {}; }
    }
    throw new Error('Processing is taking longer than expected. Check your gallery before uploading this file again.');
  } catch (error) {
    if (!queued && !enqueueAttempted && paths.length) await supabase.storage.from('media-staging').remove(paths);
    throw error;
  }
}
export async function uploadVideo(options: Options) { await validatedUpload(options,'video'); }
export async function uploadPhoto(options: Options): Promise<null> { await validatedUpload(options,'photo'); return null; }
export async function uploadValidatedPreview(file: File, user: Options['user'], videoId: string): Promise<string> {
  const result = await validatedUpload({ file, user, fileName:file.name, visibility:'private', onProgress:()=>{} },'preview',videoId);
  if (!result.path) throw new Error('No validated preview was produced.');
  return result.path;
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
        bucketName: 'media-staging',
        objectName: bucketPath,
        contentType: mimeType || 'application/octet-stream',
        cacheControl: '3600',
      },
      onError: (error) => reject(new Error(uploadFailureMessage('originalResponse' in error ? error.originalResponse?.getStatus() ?? 0 : 0))),
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.(Math.round((bytesUploaded / bytesTotal) * 100));
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}
