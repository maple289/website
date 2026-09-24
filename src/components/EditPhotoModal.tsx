import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Photo } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { MediaEditFields } from '@/components/MediaEditFields';
import { StorageImage } from '@/components/StorageImage';

export function EditPhotoModal({ photo, onClose, onSaved }: { photo: Photo; onClose: () => void; onSaved: (photo: Photo) => void }) {
  const { user } = useAuth();
  const extension = photo.storage_path.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  const originalName = extension && photo.file_name.toLowerCase().endsWith(extension.toLowerCase()) ? photo.file_name.slice(0, -extension.length) : photo.file_name;
  const [name, setName] = useState(originalName);
  const [visibility, setVisibility] = useState(photo.visibility);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting.current) onClose(); };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [onClose]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || user?.id !== photo.owner_id) return;
    const base = name.trim().replace(/\.(jpe?g|png|gif|webp|avif)$/i, '');
    // Server applies the same restrictions to direct API writes.
    if (name !== originalName && (!base || /^[.]/.test(base) || /[. ]$/.test(base) || /[<>:"/\\|?*\p{Cc}]/u.test(base) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) || new TextEncoder().encode(base + extension).length > 255)) {
      setError('Enter a valid photo name (up to 255 bytes, without path separators or reserved characters).'); return;
    }
    submitting.current = true; setSaving(true); setError('');
    try {
      const { data, error: saveError } = await supabase.from('photos').update({
        file_name: name === originalName ? photo.file_name : base + extension, visibility,
      }).eq('id', photo.id).eq('owner_id', user.id).select('*').single();
      if (saveError) {
        if (saveError.code === '23505') throw new Error('You already have a photo with that name. Choose another name.');
        if (saveError.code === '22023') throw new Error('That photo name is invalid. Choose another name.');
        throw new Error('Could not save this photo. It may have been deleted or your access changed.');
      }
      onSaved(data as Photo);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your changes. Please try again.'); }
    finally { submitting.current = false; setSaving(false); }
  };

  if (user?.id !== photo.owner_id) return null;
  return <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="edit-photo-title">
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!submitting.current) onClose(); }} />
    <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
      <div className="flex items-center justify-between px-6 pt-6">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]"><Pencil size={20} /></div><h2 id="edit-photo-title" className="text-lg font-semibold tracking-[-0.02em]">Edit Photo</h2></div>
        <button disabled={saving} onClick={onClose} aria-label="Close edit photo" className="rounded-full p-2 text-[#a7a7a7] hover:bg-[#2a2a2a] hover:text-white"><X size={18} /></button>
      </div>
      <form onSubmit={save} className="px-6 pb-7 pt-5">
        <StorageImage storagePath={photo.preview_path ?? photo.storage_path} alt={photo.file_name} className="mb-4 h-40 w-full rounded-xl bg-[#121212] object-contain" />
        <MediaEditFields kind="Photo" name={name} onNameChange={setName} visibility={visibility} onVisibilityChange={setVisibility} extension={extension} disabled={saving} />
        {error && <div role="alert" className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}
        <div className="flex gap-3">
          <button type="button" disabled={saving} onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
          <button type="submit" disabled={saving} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}Save changes</button>
        </div>
      </form>
    </div>
  </div>;
}
