import { useCallback, useRef, useState } from 'react';
import { replaceAppHistory } from '@/lib/appHistory';
import type { Photo } from '@/lib/types';

// IDs are resolved against the freshly permission-filtered gallery on return.
export function usePhotoViewerHistory(photos: Photo[], scope: string) {
  const entryUrl = useRef(window.location.href);
  const [photoId, setPhotoId] = useState<string | null>(() => {
    const saved = window.history.state?.photoViewer;
    return saved?.scope === scope && typeof saved.id === 'string' ? saved.id : null;
  });
  const update = useCallback((id: string | null) => {
    setPhotoId(id);
    if (window.location.href !== entryUrl.current) return;
    replaceAppHistory({ ...window.history.state, photoViewer: id ? { scope, id } : null }, window.location.href);
  }, [scope]);
  const index = photoId ? photos.findIndex(photo => photo.id === photoId) : -1;
  return { viewingIndex: index < 0 ? null : index,
    openPhoto: (index: number) => update(photos[index]?.id ?? null),
    closePhoto: () => update(null), onPhotoChange: update };
}
