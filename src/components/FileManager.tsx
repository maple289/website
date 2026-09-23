import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as tus from 'tus-js-client';
import {
  ArrowLeft, Check, ChevronRight, Clock3, Cloud, Copy, Download, File, FileArchive, FileAudio, FileImage, FileText,
  FileVideo, Folder, FolderPlus, Grid2X2, HardDrive, Info, List, LoaderCircle, MoreHorizontal,
  Move, Pencil, Plus, RotateCcw, Search, Share2, Star, Trash2, Upload, X,
} from 'lucide-react';
import { supabase, supabaseAnonKey } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type View = 'files' | 'recent' | 'favorites' | 'shared' | 'trash';
type Entry = {
  name: string; path: string; isFolder: boolean; size: number; updatedAt: string;
  mimeType: string; favorite: boolean; trashedAt: string | null;
};
type Metadata = { object_path: string; is_folder: boolean; is_favorite: boolean; file_size: number; mime_type: string; trashed_at: string | null; created_at: string; updated_at: string };
type UploadItem = { file: File; state: 'waiting' | 'uploading' | 'done' | 'error'; message?: string; progress?: number };

const BUCKET = 'user-files';
const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const kindLabel = (entry: Entry) => entry.isFolder ? 'Folder' : entry.mimeType.startsWith('image/') ? 'Image' : entry.mimeType.startsWith('video/') ? 'Video' : entry.mimeType.startsWith('audio/') ? 'Audio' : entry.mimeType === 'application/pdf' ? 'PDF document' : entry.mimeType.startsWith('text/') ? 'Text file' : entry.name.split('.').pop()?.toUpperCase() || 'File';
const fileIcon = (entry: Entry, size = 24) => {
  if (entry.isFolder) return <Folder size={size} className="fill-sky-400/20 text-sky-300" />;
  if (entry.mimeType.startsWith('image/')) return <FileImage size={size} className="text-fuchsia-300" />;
  if (entry.mimeType.startsWith('video/')) return <FileVideo size={size} className="text-rose-300" />;
  if (entry.mimeType.startsWith('audio/')) return <FileAudio size={size} className="text-amber-300" />;
  if (entry.mimeType.includes('pdf') || entry.mimeType.startsWith('text/') || entry.mimeType.includes('word')) return <FileText size={size} className="text-emerald-300" />;
  if (/zip|rar|7z|tar|gzip/.test(entry.mimeType)) return <FileArchive size={size} className="text-orange-300" />;
  return <File size={size} className="text-slate-300" />;
};

export function FileManager() {
  const { user } = useAuth();
  const [view, setView] = useState<View>('files');
  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  const [details, setDetails] = useState<Entry | null>(null);
  const [preview, setPreview] = useState<{ entry: Entry; url: string; text?: string } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'folder' | 'rename' | 'move' | 'copy'; entry?: Entry; entries?: Entry[]; value: string } | null>(null);
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);

  const goTo = useCallback((path: string, addHistory = true) => {
    setFolder(path);
    setSelected([]);
    if (addHistory) {
      const next = history.slice(0, historyIndex + 1);
      if (next[next.length - 1] !== path) next.push(path);
      setHistory(next);
      setHistoryIndex(next.length - 1);
    }
  }, [history, historyIndex]);
  const moveHistory = (offset: number) => {
    const nextIndex = historyIndex + offset;
    if (nextIndex < 0 || nextIndex >= history.length) return;
    setHistoryIndex(nextIndex); setFolder(history[nextIndex]); setView('files'); setSelected([]);
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError('');
    try {
      const { data: rows, error: metaError } = await supabase.from('user_file_metadata').select('object_path,is_folder,is_favorite,file_size,mime_type,trashed_at,created_at,updated_at').eq('owner_id', user.id);
      if (metaError) throw metaError;
      const metaRows = (rows ?? []) as Metadata[];
      setMetadata(metaRows);
      if (view === 'trash') {
        const trashed = metaRows.filter((item) => item.trashed_at);
        const trashedPaths = new Set(trashed.map((item) => item.object_path));
        setEntries(trashed.filter((item) => !trashedPaths.has(item.object_path.split('/').slice(0, -1).join('/'))).map(entryFromMetadata));
        return;
      }
      if (view === 'recent') {
        setEntries(metaRows.filter((item) => !item.is_folder && !item.trashed_at).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 100).map(entryFromMetadata));
        return;
      }
      if (view === 'favorites') {
        setEntries(metaRows.filter((item) => item.is_favorite && !item.trashed_at).map(entryFromMetadata));
        return;
      }
      const prefix = folder ? `${user.id}/${folder}` : user.id;
      const { data: objects, error: listError } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
      if (listError) throw listError;
      const base = `${prefix}/`;
      const built: Entry[] = (objects ?? []).filter((object) => object.name !== '.folder' && object.name !== '.keep').map((object) => {
        const path = `${base}${object.name}`;
        const meta = metaRows.find((item) => item.object_path === path);
        const isFolder = !object.id;
        return { name: object.name, path, isFolder, size: meta?.file_size ?? object.metadata?.size ?? 0, updatedAt: meta?.updated_at ?? object.updated_at ?? object.created_at ?? new Date().toISOString(), mimeType: meta?.mime_type ?? object.metadata?.mimetype ?? '', favorite: meta?.is_favorite ?? false, trashedAt: meta?.trashed_at ?? null };
      }).filter((item) => !item.trashedAt);
      setEntries(built);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load files. Apply the latest database migration and try again.');
    } finally { setLoading(false); }
  }, [user, view, folder]);

  function entryFromMetadata(item: Metadata): Entry {
    const name = item.object_path.split('/').pop() ?? item.object_path;
    return { name, path: item.object_path, isFolder: item.is_folder, size: item.file_size ?? 0, updatedAt: item.updated_at, mimeType: item.mime_type ?? '', favorite: item.is_favorite, trashedAt: item.trashed_at };
  }

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus(); }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);
  useEffect(() => {
    if (!uploadOpen && !dialog && !preview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setUploadOpen(false); setDialog(null); setPreview(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uploadOpen, dialog, preview]);

  const filtered = useMemo(() => entries.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())), [entries, query]);
  const totalBytes = metadata.filter((item) => !item.is_folder && !item.trashed_at).reduce((sum, item) => sum + (item.file_size ?? 0), 0);
  const crumbs = folder ? folder.split('/') : [];
  const title = view === 'files' ? 'My Files' : view === 'recent' ? 'Recent' : view === 'favorites' ? 'Favorites' : view === 'shared' ? 'Shared' : 'Trash';

  const register = async (path: string, isFolder: boolean, favorite = false, fileSize = 0, mimeType = '') => {
    const { error: dbError } = await supabase.from('user_file_metadata').upsert({ owner_id: user!.id, object_path: path, is_folder: isFolder, is_favorite: favorite, file_size: fileSize, mime_type: mimeType, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,object_path' });
    if (dbError) throw dbError;
  };
  const enterFolder = (entry: Entry) => { if (entry.isFolder) { setView('files'); goTo(folder ? `${folder}/${entry.name}` : entry.name); } else void openPreview(entry); };

  const openPreview = async (entry: Entry) => {
    if (entry.isFolder) return;
    const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(entry.path, 3600);
    if (signedError || !data) { setError(signedError?.message ?? 'Could not preview this file.'); return; }
    if (entry.mimeType.startsWith('text/')) {
      const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(entry.path);
      if (downloadError) { setError(downloadError.message); return; }
      setPreview({ entry, url: data.signedUrl, text: await blob.text() });
    } else setPreview({ entry, url: data.signedUrl });
  };
  const download = async (entry: Entry) => {
    if (entry.isFolder) return;
    const { data, error: downloadError } = await supabase.storage.from(BUCKET).download(entry.path);
    if (downloadError) { setError(downloadError.message); return; }
    const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = entry.name; link.click(); URL.revokeObjectURL(url);
  };
  const toggleFavorite = async (entry: Entry) => {
    const { error: updateError } = await supabase.from('user_file_metadata').upsert({ owner_id: user!.id, object_path: entry.path, is_folder: entry.isFolder, is_favorite: !entry.favorite, file_size: entry.size, mime_type: entry.mimeType, trashed_at: entry.trashedAt, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,object_path' });
    if (updateError) setError(updateError.message); else await load();
  };
  const createFolder = async () => {
    if (!dialog || !user) return;
    const name = dialog.value.trim();
    if (!name || name.includes('/') || name === '.' || name === '..') { setError('Choose a folder name without slashes.'); return; }
    const path = `${user.id}/${folder ? `${folder}/` : ''}${name}`;
    setBusy(true);
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(`${path}/.folder`, new Blob([]), { contentType: 'application/x-directory', upsert: false });
    if (uploadError) { setError(uploadError.message); setBusy(false); return; }
    try { await register(path, true); setDialog(null); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save folder.'); }
    setBusy(false);
  };
  const uploadFiles = async (files: FileList | File[]) => {
    const chosen = Array.from(files);
    if (!chosen.length || !user) return;
    const offset = uploads.length;
    setUploadOpen(true); setUploads((current) => [...current, ...chosen.map((file) => ({ file, state: 'waiting' as const }))]);
    for (const [index, file] of chosen.entries()) {
      const itemIndex = offset + index;
      setUploads((current) => current.map((item, i) => i === itemIndex ? { ...item, state: 'uploading' } : item));
      const path = `${user.id}/${folder ? `${folder}/` : ''}${file.name}`;
      let uploadError: { message: string } | null = null;
      if (file.size > 6 * 1024 * 1024) {
        try {
          await uploadLargeFile(file, path, (progress) => setUploads((current) => current.map((item, i) => i === itemIndex ? { ...item, progress } : item)));
        } catch (err) {
          uploadError = { message: err instanceof Error ? err.message : 'Upload failed.' };
        }
      } else {
        const result = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
        uploadError = result.error;
      }
      if (uploadError) setUploads((current) => current.map((item, i) => i === itemIndex ? { ...item, state: 'error', message: uploadError.message } : item));
      else {
        try { await register(path, false, false, file.size, file.type || 'application/octet-stream'); setUploads((current) => current.map((item, i) => i === itemIndex ? { ...item, state: 'done' } : item)); }
        catch (err) { setUploads((current) => current.map((item, i) => i === itemIndex ? { ...item, state: 'error', message: err instanceof Error ? err.message : 'Could not save file details.' } : item)); }
      }
    }
    await load();
  };

  const listTree = async (path: string): Promise<string[]> => {
    const { data, error: listError } = await supabase.storage.from(BUCKET).list(path, { limit: 1000 });
    if (listError) throw listError;
    const result: string[] = [];
    for (const object of data ?? []) {
      if (object.name === '.folder' || object.name === '.keep') { result.push(`${path}/${object.name}`); continue; }
      const child = `${path}/${object.name}`;
      if (!object.id) result.push(...await listTree(child)); else result.push(child);
    }
    return result;
  };
  const deleteEntries = async (items: Entry[]) => {
    if (!user) return;
    setBusy(true);
    try {
      for (const item of items) {
        const now = new Date().toISOString();
        const affectedPaths = metadata.filter((row) => row.object_path === item.path || (item.isFolder && row.object_path.startsWith(`${item.path}/`))).map((row) => row.object_path);
        const { error: metaError } = await supabase.from('user_file_metadata').update({ trashed_at: now, updated_at: now }).eq('owner_id', user.id).in('object_path', affectedPaths);
        if (metaError) throw metaError;
      }
      setSelected([]); setMenu(null); setDetails(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not move items to Trash.'); }
    setBusy(false);
  };
  const restoreEntry = async (entry: Entry) => {
    if (!user) return;
    const affectedPaths = metadata.filter((row) => row.object_path === entry.path || (entry.isFolder && row.object_path.startsWith(`${entry.path}/`))).map((row) => row.object_path);
    const { error: restoreError } = await supabase.from('user_file_metadata').update({ trashed_at: null, updated_at: new Date().toISOString() }).eq('owner_id', user.id).in('object_path', affectedPaths);
    if (restoreError) setError(restoreError.message); else await load();
  };
  const permanentDelete = async (entry: Entry) => {
    if (!user) return;
    setBusy(true);
    const paths = entry.isFolder ? await listTree(entry.path) : [entry.path];
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) setError(removeError.message);
    else {
      const affectedPaths = metadata.filter((row) => row.object_path === entry.path || (entry.isFolder && row.object_path.startsWith(`${entry.path}/`))).map((row) => row.object_path);
      const { error: metaError } = await supabase.from('user_file_metadata').delete().eq('owner_id', user.id).in('object_path', affectedPaths);
      if (metaError) setError(metaError.message);
    }
    setBusy(false); await load();
  };
  const performPathAction = async () => {
    if (!dialog?.entry || !user) return;
    const targets = dialog.entries?.length ? dialog.entries : [dialog.entry];
    const targetFolder = dialog.value.trim().replace(/^\/+|\/+$/g, '');
    if (targetFolder.split('/').includes('..')) { setError('That destination is not allowed.'); return; }
    const parentPath = targetFolder ? `${user.id}/${targetFolder}` : user.id;
    if (dialog.kind === 'rename' && (!dialog.value.trim() || dialog.value.includes('/'))) { setError('Enter a valid name without slashes.'); return; }
    setBusy(true);
    try {
      for (const entry of targets) {
        const oldParent = entry.path.split('/').slice(0, -1).join('/');
        const nextPath = dialog.kind === 'rename' ? `${oldParent}/${dialog.value.trim()}` : `${parentPath}/${entry.name}`;
        if (nextPath === entry.path || nextPath.startsWith(`${entry.path}/`)) throw new Error('Choose a different destination.');
        const paths = entry.isFolder ? await listTree(entry.path) : [entry.path];
        for (const oldPath of paths) {
          const suffix = oldPath.slice(entry.path.length);
          const target = `${nextPath}${suffix}`;
          const { error: opError } = dialog.kind === 'copy'
            ? await supabase.storage.from(BUCKET).copy(oldPath, target)
            : await supabase.storage.from(BUCKET).move(oldPath, target);
          if (opError) throw opError;
        }
        if (dialog.kind === 'copy') {
          const descendants = metadata.filter((row) => row.object_path === entry.path || (entry.isFolder && row.object_path.startsWith(`${entry.path}/`)));
          if (entry.isFolder) await register(nextPath, true, entry.favorite);
          else await register(nextPath, false, entry.favorite, entry.size, entry.mimeType);
          for (const row of descendants) {
            if (row.object_path === entry.path) continue;
            const target = `${nextPath}${row.object_path.slice(entry.path.length)}`;
            const { error: copyMetaError } = await supabase.from('user_file_metadata').insert({ owner_id: user.id, object_path: target, is_folder: row.is_folder, is_favorite: row.is_favorite, file_size: row.file_size, mime_type: row.mime_type, updated_at: new Date().toISOString() });
            if (copyMetaError) throw copyMetaError;
          }
        } else {
          const descendants = metadata.filter((row) => row.object_path === entry.path || (entry.isFolder && row.object_path.startsWith(`${entry.path}/`)));
          for (const row of descendants) {
            const target = `${nextPath}${row.object_path.slice(entry.path.length)}`;
            const { error: metaError } = await supabase.from('user_file_metadata').update({ object_path: target, updated_at: new Date().toISOString() }).eq('owner_id', user.id).eq('object_path', row.object_path);
            if (metaError) throw metaError;
          }
          if (!descendants.some((row) => row.object_path === entry.path)) await register(nextPath, entry.isFolder, entry.favorite, entry.size, entry.mimeType);
        }
      }
      setDialog(null); setSelected([]); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not complete that action.'); }
    setBusy(false);
  };

  const bulkDownload = async () => { for (const path of selected) { const item = entries.find((entry) => entry.path === path); if (item) await download(item); } };
  const bulkDelete = async () => {
    const selectedEntries = entries.filter((entry) => selected.includes(entry.path));
    const items = selectedEntries.filter((entry) => !selectedEntries.some((parent) => parent.isFolder && entry.path.startsWith(`${parent.path}/`)));
    if (view === 'trash') { for (const item of items) await permanentDelete(item); }
    else await deleteEntries(items);
  };
  const contextAction = (action: string, entry: Entry) => {
    setMenu(null);
    if (action === 'open') enterFolder(entry);
    if (action === 'preview') void openPreview(entry);
    if (action === 'download') void download(entry);
    if (action === 'rename') setDialog({ kind: 'rename', entry, value: entry.name });
    if (action === 'move' || action === 'copy') setDialog({ kind: action, entry, value: folder });
    if (action === 'favorite') void toggleFavorite(entry);
    if (action === 'delete') view === 'trash' ? void permanentDelete(entry) : void deleteEntries([entry]);
    if (action === 'restore') void restoreEntry(entry);
    if (action === 'properties') setDetails(entry);
  };
  const menuActions: Array<[string, typeof Folder, string]> = [];
  if (view === 'trash') menuActions.push(['restore', RotateCcw, 'Restore'], ['delete', Trash2, 'Delete forever']);
  else {
    menuActions.push(['open', Folder, 'Open']);
    if (menu && !menu.entry.isFolder) menuActions.push(['preview', Info, 'Preview'], ['download', Download, 'Download']);
    menuActions.push(['rename', Pencil, 'Rename'], ['move', Move, 'Move'], ['copy', Copy, 'Make a copy'], ['favorite', Star, menu?.entry.favorite ? 'Remove from Favorites' : 'Add to Favorites'], ['properties', Info, 'Properties'], ['delete', Trash2, 'Move to Trash']);
  }

  return (
    <div className="min-h-[calc(100vh-72px)] bg-[#f4f7fb] text-slate-800">
      <div className="mx-auto flex min-h-[calc(100vh-72px)] max-w-[1680px]">
        <aside className="hidden w-[248px] shrink-0 border-r border-slate-200 bg-white p-5 md:flex md:flex-col">
          <div className="mb-8 flex items-center gap-3 px-2"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><HardDrive size={21} /></div><div><p className="font-semibold text-slate-900">File Manager</p><p className="text-xs text-slate-500">Your private space</p></div></div>
          <nav className="space-y-1">
            {([['files', Folder, 'My Files'], ['recent', Clock3, 'Recent'], ['favorites', Star, 'Favorites'], ['shared', Share2, 'Shared'], ['trash', Trash2, 'Trash']] as const).map(([key, Icon, label]) => <button key={key} onClick={() => { setView(key); setFolder(''); setSelected([]); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${view === key ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Icon size={18} />{label}{key === 'trash' && metadata.some((item) => item.trashed_at) && <span className="ml-auto h-2 w-2 rounded-full bg-blue-500" />}</button>)}
          </nav>
          <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between text-sm font-semibold"><span className="flex items-center gap-2"><Cloud size={16} className="text-blue-600" />Storage</span><span className="text-xs text-slate-500">Private</span></div><p className="text-lg font-bold text-slate-900">{formatSize(totalBytes)}</p><p className="mt-1 text-xs text-slate-500">Used in File Manager</p><div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 text-[11px] text-slate-400"><HardDrive size={13} />Up to 10 GB per file</div></div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-7 lg:px-9">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0"><div className="mb-1 flex items-center gap-2 text-xs text-slate-400"><button onClick={() => { setView('files'); goTo(''); }} className="hover:text-blue-600">My Files</button>{crumbs.map((part, index) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-2"><ChevronRight size={13} /><button className="max-w-32 truncate hover:text-blue-600" onClick={() => goTo(crumbs.slice(0, index + 1).join('/'))}>{part}</button></span>)}</div><h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">{view === 'files' && crumbs.length ? crumbs[crumbs.length - 1] : title}</h1></div>
            <div className="flex items-center gap-2"><button onClick={() => moveHistory(-1)} disabled={historyIndex === 0} title="Back" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 disabled:opacity-40 sm:flex"><ArrowLeft size={17} /></button><button onClick={() => moveHistory(1)} disabled={historyIndex >= history.length - 1} title="Forward" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 disabled:opacity-40 sm:flex"><ChevronRight size={17} /></button><button onClick={() => void load()} title="Refresh" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 sm:flex"><RotateCcw size={17} /></button><button onClick={() => setDialog({ kind: 'folder', value: '' })} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 sm:hidden" title="New folder"><FolderPlus size={17} /></button><button onClick={() => setDialog({ kind: 'folder', value: '' })} className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 sm:flex"><FolderPlus size={17} />New folder</button><button onClick={() => { setUploads([]); setUploadOpen(true); }} className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700"><Upload size={17} />Upload</button></div>
          </div>
          <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 md:hidden">{([['files', Folder, 'My Files'], ['recent', Clock3, 'Recent'], ['favorites', Star, 'Favorites'], ['shared', Share2, 'Shared'], ['trash', Trash2, 'Trash']] as const).map(([key, Icon, label]) => <button key={key} onClick={() => { setView(key); setFolder(''); setSelected([]); }} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${view === key ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}><Icon size={14} />{label}</button>)}</nav>
          <div className="mb-5 flex flex-wrap items-center gap-3"><label className="flex h-11 min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"><Search size={17} className="shrink-0 text-slate-400" /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search in files" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" /><kbd className="hidden rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">⌘ K</kbd></label><div className="flex rounded-xl border border-slate-200 bg-white p-1"><button onClick={() => setLayout('grid')} aria-label="Grid view" className={`rounded-lg p-2 ${layout === 'grid' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><Grid2X2 size={17} /></button><button onClick={() => setLayout('list')} aria-label="List view" className={`rounded-lg p-2 ${layout === 'list' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><List size={17} /></button></div></div>
          {selected.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2"><span className="mr-auto text-sm font-medium text-blue-800">{selected.length} selected</span>{view !== 'trash' && <button onClick={() => { const selectedEntries = entries.filter((item) => selected.includes(item.path)); const targets = selectedEntries.filter((entry) => !selectedEntries.some((parent) => parent.isFolder && entry.path.startsWith(`${parent.path}/`))); setDialog({ kind: 'move', entry: targets[0], entries: targets, value: folder }); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"><Move size={14} className="mr-1 inline" />Move</button>}{view !== 'trash' && <button onClick={() => void bulkDownload()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"><Download size={14} className="mr-1 inline" />Download</button>}<button onClick={() => void bulkDelete()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"><Trash2 size={14} className="mr-1 inline" />{view === 'trash' ? 'Delete forever' : 'Delete'}</button><button onClick={() => setSelected([])} aria-label="Clear selection" className="rounded-lg p-1.5 text-blue-700 hover:bg-blue-100"><X size={16} /></button></div>}
          {error && <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
          {view === 'files' && crumbs.length > 0 && <button onClick={() => goTo(crumbs.slice(0, -1).join('/'))} className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-700"><ArrowLeft size={16} />Back to {crumbs.length > 1 ? crumbs[crumbs.length - 2] : 'My Files'}</button>}
          <section onDragOver={(event) => { event.preventDefault(); setDropActive(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false); }} onDrop={(event) => { event.preventDefault(); setDropActive(false); if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files); }} className={`min-h-[450px] rounded-2xl border bg-white p-4 transition sm:p-5 ${dropActive ? 'border-blue-400 bg-blue-50/70 ring-4 ring-blue-100' : 'border-slate-200'}`}>
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-800">{view === 'shared' ? 'Shared with me' : view === 'trash' ? 'Recently deleted' : 'All items'}</h2><p className="mt-0.5 text-xs text-slate-400">{view === 'shared' ? 'Files shared by other people appear here.' : `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`}</p></div>{view === 'files' && <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Plus size={15} />Add files</button>}</div>
            {loading ? <div className="flex h-64 items-center justify-center text-blue-600"><LoaderCircle className="animate-spin" /></div> : view === 'shared' ? <EmptyState icon={<Share2 size={28} />} title="File sharing isn’t enabled yet" subtitle="Files in File Manager are private to your account." /> : filtered.length === 0 ? <EmptyState icon={view === 'trash' ? <Trash2 size={28} /> : view === 'favorites' ? <Star size={28} /> : <Folder size={28} />} title={query ? 'No matching files' : view === 'trash' ? 'Trash is empty' : view === 'favorites' ? 'No favorites yet' : 'This folder is empty'} subtitle={query ? 'Try another name or clear your search.' : view === 'files' ? 'Upload files or create a folder to get started.' : 'Items you add here will appear in this view.'} /> : (
              <div className={layout === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'divide-y divide-slate-100'}>{filtered.map((entry) => <FileCard key={entry.path} entry={entry} layout={layout} selected={selected.includes(entry.path)} onSelect={(event) => { if (event) event.stopPropagation(); setSelected((current) => current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path]); }} onOpen={() => enterFolder(entry)} onMenu={(event) => { event.preventDefault(); setMenu({ x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 380), entry }); }} onFavorite={() => void toggleFavorite(entry)} onRestore={() => void restoreEntry(entry)} onDelete={() => view === 'trash' ? void permanentDelete(entry) : void deleteEntries([entry])} />)}</div>
            )}
            {dropActive && <div className="pointer-events-none fixed inset-4 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-blue-400 bg-blue-600/10 text-xl font-semibold text-blue-800">Drop files to upload</div>}
          </section>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Your files are private and visible only to you.</span><span>{filtered.length} items</span></div>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />
        </main>
        {details && <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-sm overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl"><div className="mb-7 flex items-center justify-between"><h2 className="font-semibold text-slate-900">File details</h2><button onClick={() => setDetails(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><div className="mb-6 flex h-32 items-center justify-center rounded-2xl bg-slate-50">{fileIcon(details, 46)}</div><h3 className="break-all text-lg font-semibold text-slate-900">{details.name}</h3><p className="mt-1 text-sm text-slate-500">{kindLabel(details)}</p><div className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-100 px-4">{[['Size', details.isFolder ? '—' : formatSize(details.size)], ['Location', details.path.slice(user!.id.length + 1).split('/').slice(0, -1).join('/') || 'My Files'], ['Modified', dateLabel(details.updatedAt)], ['Owner', user?.email ?? 'You'], ['Permissions', 'Private · only you'], ['Created', dateLabel(metadata.find((item) => item.object_path === details.path)?.created_at ?? details.updatedAt)]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3 text-sm"><span className="text-slate-500">{label}</span><span className="max-w-[190px] truncate text-right font-medium text-slate-800">{value}</span></div>)}</div><button onClick={() => void download(details)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16} />Download</button></aside>}
      </div>

      {menu && <div onClick={(event) => event.stopPropagation()} style={{ left: menu.x, top: menu.y }} className="fixed z-[70] w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{menuActions.map(([action, Icon, label]) => <button key={action} onClick={() => contextAction(action, menu.entry)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${action === 'delete' ? 'text-rose-600' : 'text-slate-700'}`}><Icon size={16} />{label}</button>)}</div>}

      {dialog && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form onSubmit={(event) => { event.preventDefault(); if (dialog.kind === 'folder') void createFolder(); else void performPathAction(); }} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-900">{dialog.kind === 'folder' ? 'Create a folder' : dialog.kind === 'rename' ? 'Rename item' : dialog.kind === 'copy' ? 'Copy item' : 'Move item'}</h2><button type="button" onClick={() => setDialog(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mb-2 block text-sm font-medium text-slate-700">{dialog.kind === 'folder' || dialog.kind === 'rename' ? 'Name' : 'Destination folder path'}</label><input autoFocus value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} placeholder={dialog.kind === 'folder' ? 'New folder' : dialog.kind === 'rename' ? 'New name' : 'For example: Documents/Reports'} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /><p className="mt-2 text-xs text-slate-500">{dialog.kind === 'folder' ? 'Folders are private to your account.' : 'Use a path relative to My Files. Leave empty for the root folder.'}</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Working…' : 'Continue'}</button></div></form></div>}

      {uploadOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && uploads.every((item) => item.state !== 'uploading')) setUploadOpen(false); }}><div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files); }} className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="mb-6 flex items-start justify-between"><div><h2 className="text-xl font-bold text-slate-900">Upload files</h2><p className="mt-1 text-sm text-slate-500">Add files to {folder.split('/')[folder.split('/').length - 1] || 'My Files'}</p></div><button onClick={() => setUploadOpen(false)} aria-label="Close upload dialog" className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button></div><button onClick={() => uploadInput.current?.click()} className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/60 px-6 py-10 text-center transition hover:border-blue-400 hover:bg-blue-50"><span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm"><Upload size={24} /></span><span className="font-semibold text-slate-800">Drop files here to upload</span><span className="mt-1 text-sm text-slate-500">or click to browse · multiple files supported</span></button><input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />{uploads.length > 0 && <div className="mt-5 max-h-52 space-y-2 overflow-y-auto">{uploads.map((item, index) => <div key={`${item.file.name}-${index}`} className="rounded-xl border border-slate-100 px-3 py-2.5"><div className="flex items-center gap-3"><File size={18} className="shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{item.file.name}</p><p className="text-xs text-slate-400">{item.message ?? (item.state === 'uploading' ? `${item.progress ?? 0}% · ` : '')}{formatSize(item.file.size)}</p></div>{item.state === 'uploading' ? <LoaderCircle className="animate-spin text-blue-600" size={18} /> : item.state === 'done' ? <Check className="text-emerald-500" size={18} /> : item.state === 'error' ? <X className="text-rose-500" size={18} /> : <span className="text-xs text-slate-400">Waiting</span>}</div>{item.state === 'uploading' && <div className="ml-8 mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${item.progress ?? 0}%` }} /></div>}</div>)}</div>}<div className="mt-6 flex justify-end"><button onClick={() => setUploadOpen(false)} disabled={uploads.some((item) => item.state === 'uploading')} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{uploads.length && uploads.every((item) => item.state === 'done' || item.state === 'error') ? 'Done' : 'Close'}</button></div></div></div>}

      {preview && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-3 sm:p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"><div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{preview.entry.name}</div><button onClick={() => void download(preview.entry)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Download"><Download size={17} /></button><button onClick={() => setPreview(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Close"><X size={18} /></button></div><div className="flex min-h-[300px] items-center justify-center overflow-auto bg-slate-100 p-3 sm:min-h-[500px]">{preview.entry.mimeType.startsWith('image/') ? <img src={preview.url} alt={preview.entry.name} className="max-h-[75vh] max-w-full object-contain" /> : preview.entry.mimeType.startsWith('video/') ? <video src={preview.url} controls className="max-h-[75vh] max-w-full" /> : preview.entry.mimeType === 'application/pdf' ? <iframe title={preview.entry.name} src={preview.url} className="h-[75vh] w-full rounded-lg bg-white" /> : preview.text !== undefined ? <pre className="max-h-[75vh] w-full overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-5 text-sm text-slate-800">{preview.text}</pre> : <div className="text-center"><div className="mb-3 flex justify-center">{fileIcon(preview.entry, 48)}</div><p className="font-semibold text-slate-800">Preview isn’t available</p><p className="mt-1 text-sm text-slate-500">{kindLabel(preview.entry)} · {formatSize(preview.entry.size)}</p><button onClick={() => void download(preview.entry)} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Download file</button></div>}</div></div></div>}
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex min-h-[360px] flex-col items-center justify-center px-4 text-center"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">{icon}</div><h3 className="font-semibold text-slate-800">{title}</h3><p className="mt-1 max-w-sm text-sm text-slate-400">{subtitle}</p></div>;
}

function FileCard({ entry, layout, selected, onSelect, onOpen, onMenu, onFavorite, onRestore, onDelete }: { entry: Entry; layout: 'grid' | 'list'; selected: boolean; onSelect: (event?: React.MouseEvent) => void; onOpen: () => void; onMenu: (event: React.MouseEvent) => void; onFavorite: () => void; onRestore: () => void; onDelete: () => void }) {
  const isTrash = !!entry.trashedAt;
  return <article onContextMenu={onMenu} onClick={onOpen} className={layout === 'grid' ? `group relative cursor-pointer rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md ${selected ? 'border-blue-300 bg-blue-50/60 ring-2 ring-blue-100' : 'border-slate-100 bg-white'}` : `group flex cursor-pointer items-center gap-3 px-2 py-3 transition hover:bg-slate-50 ${selected ? 'bg-blue-50' : ''}`}>
    {layout === 'grid' && <button onClick={(event) => onSelect(event)} aria-label={selected ? 'Deselect' : 'Select'} className={`absolute left-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border transition ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white/90 text-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:border-blue-500'}`}><Check size={14} /></button>}
    <div className={layout === 'grid' ? 'mb-3 flex h-28 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-slate-100' : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100'}>{entry.mimeType.startsWith('image/') && !entry.isFolder && !isTrash ? <SignedThumbnail path={entry.path} name={entry.name} /> : fileIcon(entry, layout === 'grid' ? 38 : 21)}</div>
    <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5"><p className="truncate text-sm font-semibold text-slate-800" title={entry.name}>{entry.name}</p>{entry.favorite && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}</div><p className="mt-1 truncate text-xs text-slate-400">{kindLabel(entry)}{!entry.isFolder ? ` · ${formatSize(entry.size)}` : ''}</p>{layout === 'list' && <p className="mt-1 hidden text-xs text-slate-400 sm:block">Modified {dateLabel(entry.updatedAt)}</p>}</div>
    {layout === 'grid' && <p className="truncate text-[11px] text-slate-400">{dateLabel(entry.updatedAt)}</p>}
    {layout === 'list' && <><span className="hidden w-32 text-xs text-slate-500 md:block">{entry.isFolder ? '—' : formatSize(entry.size)}</span><span className="hidden w-32 text-xs text-slate-500 lg:block">{dateLabel(entry.updatedAt)}</span><button onClick={(event) => { event.stopPropagation(); onSelect(event); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Select item"><Check size={16} /></button></>}
    {isTrash ? <div className="ml-1 flex shrink-0 gap-1"><button onClick={(event) => { event.stopPropagation(); onRestore(); }} title="Restore" className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"><RotateCcw size={16} /></button><button onClick={(event) => { event.stopPropagation(); onDelete(); }} title="Delete forever" className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button></div> : <button onClick={(event) => { event.stopPropagation(); onMenu(event); }} onContextMenu={onMenu} className="ml-1 shrink-0 rounded-lg p-2 text-slate-400 opacity-100 hover:bg-slate-100 hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100" aria-label={`Actions for ${entry.name}`}><MoreHorizontal size={17} /></button>}
  </article>;
}

function SignedThumbnail({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let active = true; supabase.storage.from(BUCKET).createSignedUrl(path, 900).then(({ data }) => { if (active && data) setUrl(data.signedUrl); }); return () => { active = false; }; }, [path]);
  return url ? <img src={url} alt={name} className="h-full w-full rounded-xl object-cover" /> : <FileImage size={38} className="text-fuchsia-300" />;
}

async function uploadLargeFile(file: File, path: string, onProgress: (percent: number) => void): Promise<void> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your sign-in expired. Please sign in again.');
  const base = new URL(baseUrl);
  const endpoint = base.hostname.endsWith('.supabase.co')
    ? `https://${base.hostname.split('.')[0]}.storage.supabase.co/storage/v1/upload/resumable`
    : new URL('/storage/v1/upload/resumable', base).toString();
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${session.access_token}`, apikey: supabaseAnonKey, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: BUCKET, objectName: path, contentType: file.type || 'application/octet-stream', cacheControl: '3600' },
      onError: reject,
      onProgress: (uploaded, total) => onProgress(Math.round(uploaded / total * 100)),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}
