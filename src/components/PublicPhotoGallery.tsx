import { useGalleryView } from '@/hooks/useGalleryView';
import { usePhotoViewerHistory } from '@/hooks/usePhotoViewerHistory';
import { MediaReactions } from './MediaReactions';
import { MediaContentMenu } from './MediaContentMenu';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Image as ImageIcon, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Photo } from '@/lib/types';
import { timeAgo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';
import { PhotoViewer } from '@/components/PhotoViewer';
import { GalleryError, GalleryToolbar } from '@/components/GalleryToolbar';

export function PublicPhotoGallery({ searchTerm }: { searchTerm: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    const { data, error } = await supabase.from('photos').select('*').eq('visibility', 'public').order('created_at', { ascending: false });
    if (version !== loadVersion.current) return;
    setError(error ? 'Could not load public photos. Please try again.' : null);
    if (!error) setPhotos(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const versionRef = loadVersion;
    const refresh = (event: Event) => { if ((event as CustomEvent).detail === 'photo') void load(); };
    void load(); window.addEventListener('media-uploaded', refresh);
    return () => { versionRef.current++; window.removeEventListener('media-uploaded', refresh); };
  }, [load]);

  const view = useGalleryView(photos, searchTerm);
  const filteredPhotos = view.visible;

  const { viewingIndex, openPhoto, closePhoto, onPhotoChange } = usePhotoViewerHistory(filteredPhotos, 'public');

  return (
    <section className="py-5">
      <GalleryToolbar title="Discover photos" scope="Public Library" subtitle="Moments and memories shared with everyone." view={view} />
      {error && <GalleryError message={error} onRetry={() => void load()} />}
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-600" /></div> : !error && filteredPhotos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-16 text-center"><ImageIcon className="mx-auto mb-3 text-[#555]" size={36} /><p className="text-sm text-[#888]">{searchTerm ? 'No matching public photos.' : 'No public photos yet.'}</p></div>
      ) : (
        <div className="mg-grid" data-density={view.density}>
          {filteredPhotos.map((photo, index) => (
            <article key={photo.id} className="mg-card text-left" onClick={() => openPhoto(index)}>
              <MediaContentMenu kind="photo" item={photo} onPreview={() => openPhoto(index)} />
              <button onClick={event => { event.stopPropagation(); openPhoto(index); }} className="mg-thumbnail" aria-label={`Open ${photo.file_name}`}>
              <StorageImage storagePath={photo.preview_path ?? photo.thumbnail_path ?? photo.storage_path} alt={photo.file_name} className="mg-image" loading="lazy" fallback={<div className="flex h-full items-center justify-center"><ImageIcon className="text-[#555]" /></div>} /><span className="mg-badge mg-privacy public"><Globe size={11} />Public</span></button>
              <div className="mg-card-body"><h3 className="mg-title" title={photo.file_name}>{photo.file_name}</h3><p className="mg-meta">{timeAgo(photo.created_at)}</p><MediaReactions mediaType="photo" mediaId={photo.id} mediaName={photo.file_name} /></div>
            </article>
          ))}
        </div>
      )}
      {viewingIndex !== null && viewingIndex < filteredPhotos.length && (
        <PhotoViewer photos={filteredPhotos} startIndex={viewingIndex} onClose={closePhoto} onPhotoChange={onPhotoChange} />
      )}
    </section>
  );
}
