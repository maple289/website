import { X } from 'lucide-react';
import type { Photo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';

export function PhotoViewer({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <button aria-label="Close" onClick={onClose} className="absolute right-5 top-5 rounded-full bg-black/60 p-3 text-white"><X size={22} /></button>
      <StorageImage storagePath={photo.preview_path} alt={photo.file_name} className="max-h-[90vh] max-w-full object-contain" fallback={<div className="text-sm text-[#888]">Unable to load photo.</div>} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}
