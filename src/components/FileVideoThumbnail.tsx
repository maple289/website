import { useEffect, useRef, useState } from 'react';
import { FileVideo, Play } from 'lucide-react';
import type { FileEntry } from '@/lib/fileTree';
import { downloadFile } from '@/lib/publicFiles';
import { captureVideoPreview } from '@/lib/mediaUploads';

// The current file API serves whole blobs. Bound optional poster work to small,
// visible videos and two concurrent jobs; never fetch large files for a tile.
let running = 0;
const pending: Array<() => Promise<void>> = [];
function drain() {
  while (running < 2 && pending.length) {
    const job = pending.shift()!;
    running++;
    void job().finally(() => { running--; drain(); });
  }
}

export function FileVideoThumbnail({ entry }: { entry: FileEntry }) {
  const tile = useRef<HTMLDivElement>(null);
  const [poster, setPoster] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setPoster(null);
    if (!tile.current || entry.size <= 0 || entry.size > 12 * 1024 * 1024) return;
    const job = async () => {
      if (!active) return;
      try {
        const { data } = await downloadFile(entry);
        if (!data || !active) return;
        const image = await captureVideoPreview(new File([data], entry.name, { type: entry.mimeType }));
        if (active) setPoster(image);
      } catch { /* Keep the video icon when permission/decoding is unavailable. */ }
    };
    const observer = new IntersectionObserver(([record]) => {
      if (!record.isIntersecting) return;
      observer.disconnect(); pending.push(job); drain();
    });
    observer.observe(tile.current);
    return () => {
      active = false; observer.disconnect();
      const index = pending.indexOf(job); if (index !== -1) pending.splice(index, 1);
    };
  }, [entry]);
  return <div ref={tile} className="fm-video-poster">
    {poster ? <img src={poster} alt={entry.name} className="h-full w-full object-cover" /> : <FileVideo size={28} className="text-slate-500" />}
    <span className="fm-play-badge" aria-hidden="true"><Play size={11} fill="currentColor" /></span>
  </div>;
}
