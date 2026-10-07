import { useEffect, useState } from 'react';
import { loadFileChildren, type FileEntry } from '@/lib/fileTree';
export function FolderDestinationPicker({ owner, value, onChange, sources, disabled }: { owner: string; value: string; onChange: (path: string) => void; sources: FileEntry[]; disabled: boolean }) {
  const [folders, setFolders] = useState<FileEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const path = value ? `${owner}/${value}` : owner;
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    loadFileChildren(path, owner, offset).then(page => { if (active) { setFolders(current => offset ? [...current, ...page.entries.filter(item => item.isFolder)] : page.entries.filter(item => item.isFolder)); setMore(page.hasMore); } }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, owner, offset]);
  const go = (next: string) => { setOffset(0); setFolders([]); onChange(next); };
  return <div className="mt-3 rounded-xl border border-slate-200 p-3"><p className="break-words text-sm font-medium">Destination: My Files{value ? ` / ${value}` : ''}</p>
    <button type="button" disabled={disabled || !value} className="my-2 rounded-lg border px-3 py-2 text-sm" onClick={() => go(value.split('/').slice(0, -1).join('/'))}>Parent folder</button>
    <div className="max-h-48 overflow-auto">{folders.map(item => <button type="button" key={item.path} disabled={disabled || sources.some(source => source.isFolder && (item.path === source.path || item.path.startsWith(`${source.path}/`)))} className="my-1 block w-full rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-40" onClick={() => go(item.path.slice(owner.length + 1))}>📁 {item.name}</button>)}</div>
    {loading && <p role="status">Loading folders…</p>}{error && <p role="alert">{error}</p>}
    {more && <button type="button" disabled={loading || disabled} onClick={() => setOffset(current => current + 100)}>Load more folders</button>}
    <p className="mt-2 text-xs text-slate-500">Continue uses the destination shown above, including all selected folder contents.</p>
  </div>;
}
