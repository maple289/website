import { useEffect, useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Photo } from '@/lib/types';
import { timeAgo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';
import { PhotoViewer } from '@/components/PhotoViewer';

export function PublicPhotoGallery({ searchTerm }: { searchTerm: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => { void supabase.from('photos').select('*').eq('visibility', 'public').order('created_at', { ascending: false }).then(({ data }) => {
      if (active) { setPhotos(data ?? []); setLoading(false); }
    }); };
    const refresh = (event: Event) => { if ((event as CustomEvent).detail === 'photo') load(); };
    load(); window.addEventListener('media-uploaded', refresh);
    return () => { active = false; window.removeEventListener('media-uploaded', refresh); };
  }, []);

  const filteredPhotos = photos.filter((photo) => {
    const term = searchTerm.trim().toLowerCase();
    return !term || photo.file_name.toLowerCase().includes(term) || (photo.owner_email ?? '').toLowerCase().includes(term);
  });

  return (
    <section className="pt-8 pb-14 sm:pt-10">
      <div className="mb-7"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#ff6971]">Public Gallery</p><h2 className="text-[27px] font-semibold tracking-[-0.04em] sm:text-[34px]">Discover photos</h2></div>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#ff3d46]" /></div> : filteredPhotos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-16 text-center"><ImageIcon className="mx-auto mb-3 text-[#555]" size={36} /><p className="text-sm text-[#888]">{searchTerm ? 'No matching public photos.' : 'No public photos yet.'}</p></div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredPhotos.map((photo, index) => (
            <button key={photo.id} onClick={() => setViewingIndex(index)} className="overflow-hidden rounded-xl bg-[#202020] text-left">
              <div className="aspect-[4/3]"><StorageImage storagePath={photo.preview_path} alt={photo.file_name} className="h-full w-full object-contain" fallback={<div className="flex h-full items-center justify-center"><ImageIcon className="text-[#555]" /></div>} /></div>
              <div className="p-3"><h3 className="truncate text-sm font-semibold">{photo.file_name}</h3><p className="mt-1 text-xs text-[#777]">{photo.owner_email ?? 'Unknown'} · {timeAgo(photo.created_at)}</p></div>
            </button>
          ))}
        </div>
      )}
      {viewingIndex !== null && viewingIndex < filteredPhotos.length && (
        <PhotoViewer photos={filteredPhotos} startIndex={viewingIndex} onClose={() => setViewingIndex(null)} />
      )}
    </section>
  );
}
