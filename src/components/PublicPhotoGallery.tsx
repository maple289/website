import { useEffect, useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Photo } from '@/lib/types';
import { timeAgo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';
import { PhotoViewer } from '@/components/PhotoViewer';

export function PublicPhotoGallery() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Photo | null>(null);

  useEffect(() => {
    supabase.from('photos').select('*').eq('visibility', 'public').order('created_at', { ascending: false }).then(({ data }) => {
      setPhotos(data ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <section className="pb-14">
      <div className="mb-7"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#ff6971]">Public Gallery</p><h2 className="text-[27px] font-semibold tracking-[-0.04em] sm:text-[34px]">Discover photos</h2></div>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#ff3d46]" /></div> : photos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-16 text-center"><ImageIcon className="mx-auto mb-3 text-[#555]" size={36} /><p className="text-sm text-[#888]">No public photos yet.</p></div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {photos.map((photo) => (
            <button key={photo.id} onClick={() => setViewing(photo)} className="overflow-hidden rounded-xl bg-[#202020] text-left">
              <div className="aspect-[4/3]"><StorageImage storagePath={photo.preview_path} alt={photo.file_name} className="h-full w-full object-cover transition duration-500 hover:scale-[1.03]" fallback={<div className="flex h-full items-center justify-center"><ImageIcon className="text-[#555]" /></div>} /></div>
              <div className="p-3"><h3 className="truncate text-sm font-semibold">{photo.file_name}</h3><p className="mt-1 text-xs text-[#777]">{photo.owner_email ?? 'Unknown'} · {timeAgo(photo.created_at)}</p></div>
            </button>
          ))}
        </div>
      )}
      {viewing && <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
