import { useGalleryView } from '@/hooks/useGalleryView';
import { usePhotoViewerHistory } from '@/hooks/usePhotoViewerHistory';
import { MediaReactions } from './MediaReactions';
import { MediaContentMenu } from './MediaContentMenu';
import { Globe, Lock, Image as ImageIcon, Loader2 } from 'lucide-react';
import type { Photo } from '@/lib/types';
import { timeAgo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';
import { PhotoViewer } from '@/components/PhotoViewer';
import { GalleryError, GalleryToolbar } from '@/components/GalleryToolbar';
import { useDiscoveryMedia } from '@/hooks/useDiscoveryMedia';
import type { MediaGroup } from '@/hooks/useMediaGroups';

export function PublicPhotoGallery({ searchTerm, group }: { searchTerm: string; group?: MediaGroup | null }) {
  const { items: photos, loading, error, load } = useDiscoveryMedia<Photo>('photo', group?.id);

  const view = useGalleryView(photos, searchTerm);
  const filteredPhotos = view.visible;

  const { viewingIndex, openPhoto, closePhoto, onPhotoChange } = usePhotoViewerHistory(filteredPhotos, group ? `group:${group.id}` : 'public');

  return (
    <section className="py-5">
      <GalleryToolbar title="Discover photos" scope={group ? `Group: ${group.name}` : 'Public Library'} subtitle={group ? `Photos shared with ${group.name}.` : 'Moments and memories shared with everyone.'} view={view} />
      {error && <GalleryError message={error} onRetry={() => void load()} />}
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-600" /></div> : !error && filteredPhotos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-16 text-center"><ImageIcon className="mx-auto mb-3 text-[#555]" size={36} /><p className="text-sm text-[#888]">{searchTerm ? (group ? 'No matching group photos.' : 'No matching public photos.') : group ? 'No photos shared with this group yet.' : 'No public photos yet.'}</p></div>
      ) : (
        <div className="mg-grid" data-density={view.density}>
          {filteredPhotos.map((photo, index) => (
            <article key={photo.id} className="mg-card text-left" onClick={() => openPhoto(index)}>
              <MediaContentMenu kind="photo" item={photo} onPreview={() => openPhoto(index)} />
              <button onClick={event => { event.stopPropagation(); openPhoto(index); }} className="mg-thumbnail" aria-label={`Open ${photo.file_name}`}>
              <StorageImage publicAccess={photo.visibility === 'public'} storagePath={photo.preview_path ?? photo.thumbnail_path ?? photo.storage_path} alt={photo.file_name} className="mg-image" loading="lazy" fallback={<div className="flex h-full items-center justify-center"><ImageIcon className="text-[#555]" /></div>} /><span className={`mg-badge mg-privacy ${photo.visibility}`}>{photo.visibility === 'public' ? <Globe size={11} /> : <Lock size={11} />}{photo.visibility === 'public' ? 'Public' : 'Private'}</span></button>
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
