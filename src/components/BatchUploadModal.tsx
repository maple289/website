import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { captureVideoPreview, uploadPhoto, uploadVideo } from '@/lib/mediaUploads';

type Item = { file: File; status: 'Waiting' | 'Uploading' | 'Completed' | 'Failed'; progress: number; message?: string };
export function BatchUploadModal({ files, kind, visibility, onClose, onItemUploaded }: {
  files: File[]; kind: 'video' | 'photo'; visibility: 'private' | 'public'; onClose: () => void; onItemUploaded?: () => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>(() => files.map((file) => ({ file, status: 'Waiting', progress: 0 })));
  const started = useRef(false);
  const refresh = useRef(onItemUploaded); refresh.current = onItemUploaded;
  const active = items.some((item) => item.status === 'Waiting' || item.status === 'Uploading');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const update = (index: number, patch: Partial<Item>) => setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
    void (async () => {
      for (const [index, file] of files.entries()) {
        update(index, { status: 'Uploading' });
        try {
          if (!user) throw new Error('Please sign in to upload.');
          const options = { file, user, fileName: file.name.replace(/\.[^.]+$/, ''), visibility, onProgress: (progress: number) => update(index, { progress }) };
          let warning: string | null | undefined;
          if (kind === 'photo') warning = await uploadPhoto(options);
          else {
            if (!file.type.startsWith('video/')) throw new Error('Please select a supported video file.');
            await uploadVideo({ ...options, previewImage: await captureVideoPreview(file) });
          }
          update(index, { status: 'Completed', progress: 100, message: warning ?? undefined });
          if (refresh.current) refresh.current();
          else window.dispatchEvent(new CustomEvent('media-uploaded', { detail: kind }));
        } catch (cause) { update(index, { status: 'Failed', message: cause instanceof Error ? cause.message : 'Upload failed. Please try again.' }); }
      }
    })();
  }, [files, kind, user, visibility]);
  useEffect(() => {
    if (!active) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [active]);
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Upload ${kind}s`}>
    <div className="w-full max-w-lg rounded-2xl border border-[#3a3a3a] bg-[#181818] p-6 text-white shadow-2xl">
      <h2 className="text-lg font-semibold">Upload {kind}s</h2><p className="mt-1 text-sm text-[#aaa]">{visibility === 'private' ? 'Private' : 'Public'} · {items.filter((item) => item.status === 'Completed').length} of {items.length} completed</p>
      <div className="my-5 max-h-[60vh] space-y-3 overflow-y-auto" aria-live="polite">{items.map((item, index) => <div key={index} className="rounded-xl border border-[#333] p-3">
        <p className="truncate text-sm font-medium" title={item.file.name}>{item.file.name}</p>
        <p className={`mt-1 text-xs ${item.status === 'Failed' ? 'text-red-300' : 'text-[#aaa]'}`}>{item.status}{item.status === 'Uploading' ? ` · ${item.progress}%` : ''}{item.message ? ` — ${item.message}` : ''}</p>
        <progress aria-label={`Upload progress for ${item.file.name}`} value={item.progress} max={100} className="mt-2 h-1.5 w-full accent-blue-500" />
      </div>)}</div>
      <button disabled={active} onClick={onClose} className="w-full rounded-xl bg-[#ff3d46] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{active ? 'Uploading…' : 'Done'}</button>
    </div>
  </div>;
}
