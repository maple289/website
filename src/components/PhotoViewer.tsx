import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Photo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';

type PhotoViewerProps = {
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
};

export function PhotoViewer({ photos, startIndex, onClose }: PhotoViewerProps) {
  const [index, setIndex] = useState(startIndex);

  const photo = photos[index];

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext]);

  if (!photo) return null;

  const hasMultiple = photos.length > 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <button aria-label="Close" onClick={onClose} className="absolute right-5 top-5 z-10 rounded-full bg-black/60 p-3 text-white transition hover:bg-black/80"><X size={22} /></button>

      {hasMultiple && (
        <>
          <button
            aria-label="Previous photo"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
          >
            <ChevronLeft size={26} />
          </button>
          <button
            aria-label="Next photo"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
          >
            <ChevronRight size={26} />
          </button>
        </>
      )}

      <div className="flex max-h-[90vh] max-w-full flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <StorageImage
          storagePath={photo.storage_path}
          alt={photo.file_name}
          className="max-h-[82vh] max-w-full object-contain"
          fallback={<div className="text-sm text-[#888]">Unable to load photo.</div>}
        />
        <div className="mt-3 flex items-center gap-3 text-center">
          <p className="text-sm font-medium text-[#ddd]">{photo.file_name}</p>
          {hasMultiple && (
            <span className="text-xs text-[#888]">{index + 1} of {photos.length}</span>
          )}
        </div>
      </div>
    </div>
  );
}
