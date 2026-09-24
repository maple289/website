import { MediaReactions } from './MediaReactions';
import { useEffect, useState } from 'react';
import { Globe, Image as ImageIcon, Loader2 } from 'lucide-react';
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
    <section className="py-5">
      <div className="mg-toolbar"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#ff6971]">Public Gallery</p><h2 className="text-[27px] font-semibold tracking-[-0.04em] sm:text-[34px]">Discover photos</h2></div>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#ff3d46]" /></div> : filteredPhotos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-16 text-center"><ImageIcon className="mx-auto mb-3 text-[#555]" size={36} /><p className="text-sm text-[#888]">{searchTerm ? 'No matching public photos.' : 'No public photos yet.'}</p></div>
      ) : (
        <div className="mg-grid">
          {filteredPhotos.map((photo, index) => (
            <article key={photo.id} className="mg-card text-left" onClick={() => setViewingIndex(index)}>
              <button onClick={() => setViewingIndex(index)} className="mg-thumbnail" aria-label={`Open ${photo.file_name}`}>
              <StorageImage storagePath={photo.preview_path ?? photo.thumbnail_path ?? photo.storage_path} alt={photo.file_name} className="mg-image" loading="lazy" fallback={<div className="flex h-full items-center justify-center"><ImageIcon className="text-[#555]" /></div>} /><span className="mg-badge mg-privacy public"><Globe size={11} />Public</span></button>
              <div className="mg-card-body"><h3 className="mg-title" title={photo.file_name}>{photo.file_name}</h3><p className="mg-meta">{photo.owner_email ?? 'Unknown'} · {timeAgo(photo.created_at)}</p><MediaReactions mediaType="photo" mediaId={photo.id} /></div>
            </article>
          ))}
        </div>
      )}
      {viewingIndex !== null && viewingIndex < filteredPhotos.length && (
        <PhotoViewer photos={filteredPhotos} startIndex={viewingIndex} onClose={() => setViewingIndex(null)} />
      )}
    </section>
  );
}
