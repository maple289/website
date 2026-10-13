/* eslint-disable react-refresh/only-export-components -- Isolated browser fixture. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FilePreview } from '@/components/FilePreview';
import type { FileEntry } from '@/lib/fileTree';
import '@/index.css';

const entry: FileEntry = { id: 'fixture-video', name: 'public-video.webm', path: 'fixture/public-video.webm',
  isFolder: false, size: 992, mimeType: 'video/webm', updatedAt: '2026-10-13', favorite: false, trashedAt: null };
async function loadVideo(_entry: FileEntry, signal: AbortSignal) {
  const codec = new URLSearchParams(location.search).get('codec') === 'mp4' ? 'mp4' : 'webm';
  return (await fetch(`/tests/fixtures/playback-ended.${codec}`, { signal })).blob();
}
function Harness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open video file preview</button>
    {open && <FilePreview entry={entry} onClose={() => setOpen(false)} onDownload={() => { throw new Error('Anonymous download forbidden'); }}
      allowDownload={false} loadVideo={loadVideo} trackViews={false} />}</>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
