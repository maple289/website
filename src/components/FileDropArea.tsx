import { useEffect, useState, type ReactNode } from 'react';

export function FileDropArea({ enabled, onFiles, children }: { enabled: boolean; onFiles: (files: File[]) => void; children: ReactNode }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const reset = () => setActive(false);
    window.addEventListener('dragend', reset); window.addEventListener('drop', reset); window.addEventListener('blur', reset);
    return () => { window.removeEventListener('dragend', reset); window.removeEventListener('drop', reset); window.removeEventListener('blur', reset); };
  }, []);
  return <div className={`relative min-h-[240px] ${active && enabled ? 'rounded-xl ring-4 ring-blue-400' : ''}`}
    onDragOver={(event) => { if (!enabled || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setActive(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setActive(false); }}
    onDrop={(event) => { if (!enabled || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); event.stopPropagation(); setActive(false); if (event.dataTransfer.files.length) onFiles(Array.from(event.dataTransfer.files)); }}>
    {children}
    {active && enabled && <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-400 bg-blue-950/80 p-6 text-center text-xl font-semibold text-white">Drop files here to upload</div>}
  </div>;
}
