import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as tus from 'tus-js-client';
import {
  ArrowLeft, Check, ChevronRight, Clock3, Cloud, Copy, Download, File, FileArchive, FileAudio, FileImage, FileText,
  FileVideo, Folder, FolderPlus, Globe, Grid2X2, GitBranch, HardDrive, Info, List, LoaderCircle, MoreHorizontal,
  Move, Pencil, Plus, RotateCcw, Search, Share2, Star, Trash2, Upload, X,
} from 'lucide-react';
import { supabase, supabaseAnonKey } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { FileShareModal } from '@/components/FileShareModal';
import './FileManager.css';
import { downloadFile, loadPublicFiles } from '@/lib/publicFiles';
import { FileTree } from '@/components/FileTree';
import { getFileMetadataTree, loadFileChildren, type FileEntry } from '@/lib/fileTree';

type View = 'files' | 'recent' | 'favorites' | 'shared' | 'trash';
type Entry = FileEntry;
type Metadata = { object_path: string; is_folder: boolean; is_favorite: boolean; file_size: number; mime_type: string; trashed_at: string | null; created_at: string; updated_at: string };
type UploadItem = { file: File; state: 'waiting' | 'uploading' | 'done' | 'error'; message?: string; progress?: number };
type SearchRow = { object_path: string; name: string; location: string; is_folder: boolean; file_size: number; mime_type: string; updated_at: string; is_favorite: boolean };

const BUCKET = 'user-files';
const SEARCH_PAGE_SIZE = 50;
const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;
const dateLabel = (value: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const kindLabel = (entry: Entry) => entry.isFolder ? 'Folder' : entry.mimeType.startsWith('image/') ? 'Image' : entry.mimeType.startsWith('video/') ? 'Video' : entry.mimeType.startsWith('audio/') ? 'Audio' : entry.mimeType === 'application/pdf' ? 'PDF document' : entry.mimeType.startsWith('text/') ? 'Text file' : entry.name.split('.').pop()?.toUpperCase() || 'File';
const fileIcon = (entry: Entry, size = 24) => {
  if (entry.isFolder) return <Folder size={size} strokeWidth={1.5} className="fill-[#FFD45A] text-[#D99A18] drop-shadow-sm" />;
  if (entry.mimeType.startsWith('image/')) return <FileImage size={size} className="text-fuchsia-300" />;
  if (entry.mimeType.startsWith('video/')) return <FileVideo size={size} className="text-rose-300" />;
  if (entry.mimeType.startsWith('audio/')) return <FileAudio size={size} className="text-amber-300" />;
  if (entry.mimeType.includes('pdf') || entry.mimeType.startsWith('text/') || entry.mimeType.includes('word')) return <FileText size={size} className="text-emerald-300" />;
  if (/zip|rar|7z|tar|gzip/.test(entry.mimeType)) return <FileArchive size={size} className="text-orange-300" />;
  return <File size={size} className="text-slate-300" />;
};

export function FileManager({ searchTerm, onSearchTermChange }: { searchTerm: string; onSearchTermChange: (value: string) => void }) {
  const { user } = useAuth();
  const guest = !user;
  const [publicFolder, setPublicFolder] = useState<Entry | null>(null);
  const [view, setView] = useState<View>('files');
  const [shareEntry, setShareEntry] = useState<Entry | null>(null);
  const [shareIndicators, setShareIndicators] = useState<Record<string, 'users' | 'everyone'>>({});
  const [shareVersion, setShareVersion] = useState(0);
  const [sharedFolder, setSharedFolder] = useState('');
  const [sharedOffset, setSharedOffset] = useState(0);
  const [sharedHasMore, setSharedHasMore] = useState(false);
  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<Entry[]>([]);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list' | 'tree'>('grid');
  const [treeEntries, setTreeEntries] = useState<Entry[]>([]);
  const [rootHasMore, setRootHasMore] = useState(false);
  const [rootOffset, setRootOffset] = useState(1000);
  const [rootPaging, setRootPaging] = useState(false);
  const rootSharedOffset = useRef(50);
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
  const latestSearchTerm = useRef(searchTerm);
  const listingState = useRef({ version: 0 });
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
    const version = ++listingState.current.version;
    setLoading(true); setError(''); setRootHasMore(false); setRootPaging(false);
    try {
      if (!user) {
        const page = await loadPublicFiles(publicFolder?.path);
        if (version !== listingState.current.version) return;
        setEntries(page.entries); setRootHasMore(page.hasMore); setRootOffset(page.nextOffset);
        return;
      }
      if (view === 'shared') {
        const { data, error: sharedError } = await supabase.rpc('list_shared_user_files', { p_folder: sharedFolder, p_offset: sharedOffset });
        if (version !== listingState.current.version) return;
        if (sharedError) throw sharedError;
        const rows = (data ?? []) as Metadata[];
        const page = rows.slice(0, 50).map(entryFromMetadata);
        setEntries((current) => sharedOffset === 0 ? page : [...current, ...page]);
        setSharedHasMore(rows.length > 50);
        return;
      }
      const { data: rows, error: metaError } = await supabase.from('user_file_metadata').select('object_path,is_folder,is_favorite,file_size,mime_type,trashed_at,created_at,updated_at').eq('owner_id', user.id);
      if (version !== listingState.current.version) return;
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
      if (version !== listingState.current.version) return;
      if (listError) throw listError;
      const base = `${prefix}/`;
      const built: Entry[] = (objects ?? []).filter((object) => object.name !== '.folder' && object.name !== '.keep').map((object) => {
        const path = `${base}${object.name}`;
        const meta = metaRows.find((item) => item.object_path === path);
        const isFolder = !object.id;
        return { name: object.name, path, isFolder, size: meta?.file_size ?? object.metadata?.size ?? 0, updatedAt: meta?.updated_at ?? object.updated_at ?? object.created_at ?? new Date().toISOString(), mimeType: meta?.mime_type ?? object.metadata?.mimetype ?? '', favorite: meta?.is_favorite ?? false, trashedAt: meta?.trashed_at ?? null };
      }).filter((item) => !item.trashedAt);
      if (!folder) {
        const { data: shared, error: sharedError } = await supabase.rpc('list_shared_user_files', { p_folder: '', p_offset: 0 });
        if (version !== listingState.current.version) return;
        if (sharedError) throw sharedError;
        built.push(...((shared ?? []) as Metadata[]).slice(0, 50).map(entryFromMetadata));
        rootSharedOffset.current = 50;
        setSharedHasMore((shared?.length ?? 0) > 50); setSharedOffset(0);
      }
      setEntries(built);
      setRootHasMore(objects?.length === 1000);
      setRootOffset(1000);
    } catch (err) {
      if (version !== listingState.current.version) return;
      setError(err instanceof Error ? err.message : 'Could not load files. Apply the latest database migration and try again.');
    } finally { if (version === listingState.current.version) { setLoading(false); setSearchRevision((value) => value + 1); } }
  }, [user, view, folder, sharedFolder, sharedOffset, publicFolder]);

  const searchAllFiles = useCallback(async (offset = 0) => {
    const query = searchTerm.trim();
    if (!query) return;
    setSearchLoading(true);
    try {
      if (!user) {
        const page = await loadPublicFiles('', offset, query);
        if (latestSearchTerm.current.trim() !== query) return;
        setSearchResults((current) => offset ? [...current, ...page.entries] : page.entries);
        setSearchOffset(page.nextOffset); setSearchHasMore(page.hasMore);
        return;
      }
      const { data, error: searchError } = await supabase.rpc('search_user_files', {
        p_query: query,
        p_limit: SEARCH_PAGE_SIZE + 1,
        p_offset: offset,
      });
      if (searchError) throw searchError;
      if (latestSearchTerm.current.trim() !== query) return;
      const rows = (data ?? []) as SearchRow[];
      const page = rows.slice(0, SEARCH_PAGE_SIZE).map((row) => ({
        name: row.name,
        path: row.object_path,
        isFolder: row.is_folder,
        size: row.file_size,
        updatedAt: row.updated_at,
        mimeType: row.mime_type,
        favorite: row.is_favorite,
        trashedAt: null,
      }));
      setSearchResults((current) => offset === 0 ? page : [...current, ...page]);
      setSearchOffset(offset + page.length);
      setSearchHasMore(rows.length > SEARCH_PAGE_SIZE);
    } catch (err) {
      if (latestSearchTerm.current.trim() !== query) return;
      setError(err instanceof Error ? err.message : 'Could not search your files.');
      if (offset === 0) setSearchResults([]);
    } finally {
      if (latestSearchTerm.current.trim() === query) setSearchLoading(false);
    }
  }, [searchTerm, user]);

  function entryFromMetadata(item: Metadata): Entry {
    const name = item.object_path.split('/').pop() ?? item.object_path;
    return { name, path: item.object_path, isFolder: item.is_folder, size: item.file_size ?? 0, updatedAt: item.updated_at, mimeType: item.mime_type ?? '', favorite: item.is_favorite, trashedAt: item.trashed_at };
  }

  useEffect(() => { const state = listingState.current; void load(); return () => { state.version++; }; }, [load]);
  useEffect(() => { latestSearchTerm.current = searchTerm; }, [searchTerm]);
  useEffect(() => {
    const query = searchTerm.trim();
    if (!query) {
      setSearchResults([]);
      setSearchOffset(0);
      setSearchHasMore(false);
      setSearchLoading(false);
      return;
    }
    setSearchResults([]); setSearchOffset(0); setSearchHasMore(false); setSearchLoading(true);
    const timer = window.setTimeout(() => { void searchAllFiles(0); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm, searchAllFiles, searchRevision]);
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

  const isSearching = Boolean(searchTerm.trim());
  const filtered = useMemo(() => isSearching ? searchResults : entries, [entries, isSearching, searchResults]);
  const actionEntries = layout === 'tree' ? treeEntries : filtered;
  const owns = (entry: Entry) => entry.path.startsWith(`${user?.id}/`);
  const selectionOwned = selected.length > 0 && selected.every((path) => path.startsWith(`${user?.id}/`));
  useEffect(() => {
    let active = true;
    const paths = actionEntries.map((entry) => entry.path);
    setShareIndicators({});
    if (!paths.length) return;
    if (guest) { setShareIndicators(Object.fromEntries(paths.map((path) => [path, 'everyone']))); return; }
    const readIndicators = async () => {
      const indicators: Record<string, 'users' | 'everyone'> = {};
      for (let start = 0; start < paths.length; start += 1000) {
        const { data, error: rpcError } = await supabase.rpc('get_file_share_indicators', { p_paths: paths.slice(start, start + 1000) });
        if (!active) return;
        if (rpcError) { setError(rpcError.message); return; }
        for (const row of data ?? []) indicators[row.object_path] = row.everyone ? 'everyone' : 'users';
      }
      setShareIndicators(indicators);
    };
    void readIndicators();
    return () => { active = false; };
  }, [actionEntries, shareVersion, guest]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);
  const totalBytes = metadata.filter((item) => !item.is_folder && !item.trashed_at).reduce((sum, item) => sum + (item.file_size ?? 0), 0);
  const crumbs = folder ? folder.split('/') : [];
  const title = guest ? publicFolder?.name ?? 'Public files' : view === 'files' ? folder ? 'My Files' : 'All files' : view === 'recent' ? 'Recent' : view === 'favorites' ? 'Favorites' : view === 'shared' ? 'Shared' : 'Trash';

  const register = async (path: string, isFolder: boolean, favorite = false, fileSize = 0, mimeType = '') => {
    const { error: dbError } = await supabase.from('user_file_metadata').upsert({ owner_id: user!.id, object_path: path, is_folder: isFolder, is_favorite: favorite, file_size: fileSize, mime_type: mimeType, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,object_path' });
    if (dbError) throw dbError;
  };
  const enterFolder = (entry: Entry) => {
    if (!entry.isFolder) { void openPreview(entry); return; }
    onSearchTermChange('');
    if (guest) { setPublicFolder(entry); setSelected([]); return; }
    if (owns(entry)) { setView('files'); goTo(entry.path.split('/').slice(1).join('/')); }
    else { setSharedFolder(entry.path); setSharedOffset(0); setSelected([]); setView('shared'); }
  };
  const openSearchResult = (entry: Entry) => {
    if (!entry.isFolder) { void openPreview(entry); return; }
    enterFolder(entry);
  };
  const resultLocation = (entry: Entry) => {
    if (entry.location) return entry.location;
    const relativePath = entry.path.split('/').slice(1).join('/');
    const parent = relativePath.split('/').slice(0, -1).join('/');
    return `${owns(entry) ? 'My Files' : 'Shared'}${parent ? ` / ${parent}` : ''}`;
  };

  const openPreview = async (entry: Entry) => {
    if (entry.isFolder) return;
    // Authenticated downloads recheck storage RLS; do not mint transferable signed links.
    const { data: blob, error: downloadError } = await downloadFile(entry);
    if (downloadError || !blob) { setError(downloadError?.message ?? 'File unavailable'); return; }
    setPreview({ entry, url: URL.createObjectURL(blob), text: entry.mimeType.startsWith('text/') ? await blob.text() : undefined });
  };
  const download = async (entry: Entry) => {
    if (entry.isFolder) return;
    const { data, error: downloadError } = await downloadFile(entry);
    if (downloadError || !data) { setError(downloadError?.message ?? 'File unavailable'); return; }
    const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = entry.name; link.click(); URL.revokeObjectURL(url);
  };
  const toggleFavorite = async (entry: Entry) => {
    const { error: updateError } = await supabase.from('user_file_metadata').upsert({ owner_id: user!.id, object_path: entry.path, is_folder: entry.isFolder, is_favorite: !entry.favorite, file_size: entry.size, mime_type: entry.mimeType, trashed_at: entry.trashedAt, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,object_path' });
    if (updateError) setError(updateError.message); else await load();
  };
  const createFolder = async () => {
    if (!dialog || !user) return;
    if (view === 'shared') { setError('Shared folders are read-only.'); return; }
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
    if (view === 'shared') { setError('Shared folders are read-only.'); return; }
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
    const result: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error: listError } = await supabase.storage.from(BUCKET).list(path, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (listError) throw listError;
      for (const object of data ?? []) {
        const child = `${path}/${object.name}`;
        if (object.name === '.folder' || object.name === '.keep' || object.id) result.push(child);
        else result.push(...await listTree(child));
      }
      if ((data?.length ?? 0) < 1000) break;
    }
    return result;
  };
  const changeMetadata = async (paths: string[], trashedAt?: string | null) => {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const query = trashedAt === undefined
        ? supabase.from('user_file_metadata').delete()
        : supabase.from('user_file_metadata').update({ trashed_at: trashedAt, updated_at: new Date().toISOString() });
      const { error: changeError } = await query.eq('owner_id', user!.id).in('object_path', paths.slice(offset, offset + 100));
      if (changeError) throw changeError;
    }
  };
  const deleteEntries = async (items: Entry[]) => {
    if (!user) return;
    setBusy(true);
    try {
      for (const item of items) {
        const now = new Date().toISOString();
        const affectedPaths = (await getFileMetadataTree(item, user.id)).map((row) => row.object_path);
        if (!affectedPaths.includes(item.path)) { await register(item.path, item.isFolder, item.favorite, item.size, item.mimeType); affectedPaths.push(item.path); }
        await changeMetadata(affectedPaths, now);
      }
      setSelected([]); setMenu(null); setDetails(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not move items to Trash.'); }
    setBusy(false);
  };
  const restoreEntry = async (entry: Entry) => {
    if (!user) return;
    try {
      const affectedPaths = (await getFileMetadataTree(entry, user.id)).map((row) => row.object_path);
      await changeMetadata(affectedPaths, null);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not restore this item.'); }
  };
  const permanentDelete = async (entry: Entry) => {
    if (!user) return;
    setBusy(true);
    try {
      const paths = entry.isFolder ? await listTree(entry.path) : [entry.path];
      for (let offset = 0; offset < paths.length; offset += 1000) {
        const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths.slice(offset, offset + 1000));
        if (removeError) throw removeError;
      }

      const affectedPaths = (await getFileMetadataTree(entry, user.id)).map((row) => row.object_path);
      await changeMetadata(affectedPaths);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not permanently delete this item.');
    } finally {
      setBusy(false);
    }
    await load();
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
          const descendants = (await getFileMetadataTree(entry, user.id));
          if (entry.isFolder) await register(nextPath, true, entry.favorite);
          else await register(nextPath, false, entry.favorite, entry.size, entry.mimeType);
          for (const row of descendants) {
            if (row.object_path === entry.path) continue;
            const target = `${nextPath}${row.object_path.slice(entry.path.length)}`;
            const { error: copyMetaError } = await supabase.from('user_file_metadata').insert({ owner_id: user.id, object_path: target, is_folder: row.is_folder, is_favorite: row.is_favorite, file_size: row.file_size, mime_type: row.mime_type, updated_at: new Date().toISOString() });
            if (copyMetaError) throw copyMetaError;
          }
        } else {
          const descendants = (await getFileMetadataTree(entry, user.id));
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

  const bulkDownload = async () => { for (const path of selected) { const item = actionEntries.find((entry) => entry.path === path); if (item) await download(item); } };
  const bulkDelete = async () => {
    const selectedEntries = actionEntries.filter((entry) => selected.includes(entry.path) && owns(entry));
    const items = selectedEntries.filter((entry) => !selectedEntries.some((parent) => parent.isFolder && entry.path.startsWith(`${parent.path}/`)));
    for (const item of items.filter((entry) => entry.trashedAt)) await permanentDelete(item);
    const activeItems = items.filter((entry) => !entry.trashedAt);
    if (activeItems.length) await deleteEntries(activeItems);
  };
  const contextAction = (action: string, entry: Entry) => {
    setMenu(null);
    if (action === 'open') enterFolder(entry);
    if (action === 'preview') void openPreview(entry);
    if (action === 'download') void download(entry);
    if (action === 'share' && owns(entry)) setShareEntry(entry);
    if (action === 'rename') setDialog({ kind: 'rename', entry, value: entry.name });
    if (action === 'move' || action === 'copy') setDialog({ kind: action, entry, value: folder });
    if (action === 'favorite') void toggleFavorite(entry);
    if (action === 'delete') { if (entry.trashedAt) void permanentDelete(entry); else void deleteEntries([entry]); }
    if (action === 'restore') void restoreEntry(entry);
    if (action === 'properties') setDetails(entry);
  };
  const menuActions: Array<[string, typeof Folder, string]> = [];
  if (menu?.entry.trashedAt && owns(menu.entry)) menuActions.push(['restore', RotateCcw, 'Restore'], ['delete', Trash2, 'Delete forever']);
  else {
    menuActions.push(['open', Folder, 'Open']);
    if (menu && !menu.entry.isFolder) menuActions.push(['preview', Info, 'Preview'], ['download', Download, 'Download']);
    if (menu && owns(menu.entry)) menuActions.push(['share', Share2, 'Share'], ['rename', Pencil, 'Rename'], ['move', Move, 'Move'], ['copy', Copy, 'Make a copy'], ['favorite', Star, menu.entry.favorite ? 'Remove from Favorites' : 'Add to Favorites'], ['delete', Trash2, 'Move to Trash']);
    menuActions.push(['properties', Info, 'Properties']);
  }

  const changeLayout = (next: 'grid' | 'list' | 'tree') => {
    if (layout === 'tree' && next !== 'tree') setSelected((current) => current.filter((path) => filtered.some((entry) => entry.path === path)));
    setLayout(next);
  };
  const loadMoreRoot = async () => {
    if (rootPaging) return;
    const version = listingState.current.version;
    setRootPaging(true);
    try {
      const page = user ? await loadFileChildren(folder ? `${user.id}/${folder}` : user.id, user.id, rootOffset) : await loadPublicFiles(publicFolder?.path, rootOffset);
      if (version !== listingState.current.version) return;
      setEntries((current) => [...current, ...page.entries]);
      setRootOffset(page.nextOffset); setRootHasMore(page.hasMore);
    } catch (err) {
      if (version === listingState.current.version) setError(err instanceof Error ? err.message : 'Could not load more items.');
    } finally { if (version === listingState.current.version) setRootPaging(false); }
  };

  const loadMoreSharedRoot = async () => {
    if (!user || rootPaging) return;
    const version = listingState.current.version;
    setRootPaging(true);
    try {
      const { data, error: sharedError } = await supabase.rpc('list_shared_user_files', { p_folder: '', p_offset: rootSharedOffset.current });
      if (version !== listingState.current.version) return;
      if (sharedError) throw sharedError;
      setEntries((current) => [...current, ...((data ?? []) as Metadata[]).slice(0, 50).map(entryFromMetadata)]);
      rootSharedOffset.current += 50;
      setSharedHasMore((data?.length ?? 0) > 50);
    } catch {
      if (version === listingState.current.version) setError('Could not load more shared items.');
    } finally { if (version === listingState.current.version) setRootPaging(false); }
  };

  const renderFileEntry = (entry: Entry) => <FileCard key={entry.path} entry={entry} shareMode={shareIndicators[entry.path]} location={guest || isSearching || view === 'shared' ? resultLocation(entry) : undefined} layout={layout === 'tree' ? 'list' : layout} selected={selected.includes(entry.path)} onSelect={(event) => { if (event) event.stopPropagation(); setSelected((current) => current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path]); }} onOpen={() => isSearching ? openSearchResult(entry) : enterFolder(entry)} onMenu={(event) => { event.preventDefault(); setMenu({ x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 380), entry }); }} onRestore={() => void restoreEntry(entry)} onDelete={() => entry.trashedAt ? void permanentDelete(entry) : void deleteEntries([entry])} />;

  return (
    <div className="file-manager min-h-[calc(100vh-72px)] text-slate-800">
      <div className="mx-auto flex min-h-[calc(100vh-72px)] max-w-[1680px]">
        {!guest && <aside className="fm-sidebar hidden w-[248px] shrink-0 border-r border-slate-200 bg-white p-5 md:flex md:flex-col">
          <div className="mb-8 flex items-center gap-3 px-2"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><HardDrive size={21} /></div><div><p className="font-semibold text-slate-900">File Manager</p><p className="text-xs text-slate-500">Your private space</p></div></div>
          <nav className="space-y-1">
            {([['files', Folder, 'My Files'], ['recent', Clock3, 'Recent'], ['favorites', Star, 'Favorites'], ['shared', Share2, 'Shared'], ['trash', Trash2, 'Trash']] as const).map(([key, Icon, label]) => <button key={key} onClick={() => { setView(key); setFolder(''); setSharedFolder(''); setSharedOffset(0); setSelected([]); onSearchTermChange(''); }} data-active={view === key} className={`fm-nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${view === key ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Icon size={18} />{label}{key === 'trash' && metadata.some((item) => item.trashed_at) && <span className="ml-auto h-2 w-2 rounded-full bg-blue-500" />}</button>)}
          </nav>
          <div className="fm-storage mt-auto rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between text-sm font-semibold"><span className="flex items-center gap-2"><Cloud size={16} className="text-blue-600" />Storage</span><span className="text-xs text-slate-500">Private</span></div><p className="text-lg font-bold text-slate-900">{formatSize(totalBytes)}</p><p className="mt-1 text-xs text-slate-500">Used in File Manager</p><div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 text-[11px] text-slate-400"><HardDrive size={13} />Up to 10 GB per file</div></div>
        </aside>}
        <main className="fm-main min-w-0 flex-1 px-4 py-5 sm:px-7 lg:px-9">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">{!guest && view !== 'shared' && <div className="mb-1 flex items-center gap-2 text-xs text-slate-400"><button onClick={() => { setView('files'); goTo(''); }} className="hover:text-blue-600">My Files</button>{crumbs.map((part, index) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-2"><ChevronRight size={13} /><button className="max-w-32 truncate hover:text-blue-600" onClick={() => goTo(crumbs.slice(0, index + 1).join('/'))}>{part}</button></span>)}</div>}<h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">{view === 'files' && crumbs.length ? crumbs[crumbs.length - 1] : title}</h1></div>
            {!guest && view !== 'shared' && <div className="flex items-center gap-2"><button onClick={() => moveHistory(-1)} disabled={historyIndex === 0} title="Back" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 disabled:opacity-40 sm:flex"><ArrowLeft size={17} /></button><button onClick={() => moveHistory(1)} disabled={historyIndex >= history.length - 1} title="Forward" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 disabled:opacity-40 sm:flex"><ChevronRight size={17} /></button><button onClick={() => void load()} title="Refresh" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 sm:flex"><RotateCcw size={17} /></button><button onClick={() => setDialog({ kind: 'folder', value: '' })} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 sm:hidden" title="New folder"><FolderPlus size={17} /></button><button onClick={() => setDialog({ kind: 'folder', value: '' })} className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 sm:flex"><FolderPlus size={17} />New folder</button><button onClick={() => { setUploads([]); setUploadOpen(true); }} className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700"><Upload size={17} />Upload</button></div>}
          </div>
          {!guest && <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 md:hidden">{([['files', Folder, 'My Files'], ['recent', Clock3, 'Recent'], ['favorites', Star, 'Favorites'], ['shared', Share2, 'Shared'], ['trash', Trash2, 'Trash']] as const).map(([key, Icon, label]) => <button key={key} onClick={() => { setView(key); setFolder(''); setSharedFolder(''); setSharedOffset(0); setSelected([]); onSearchTermChange(''); }} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${view === key ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}><Icon size={14} />{label}</button>)}</nav>}
          <div className="mb-5 flex flex-wrap items-center gap-3"><label className="fm-search flex h-11 min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"><Search size={17} className="shrink-0 text-slate-400" /><input ref={searchInput} value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="Search in files" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" /><kbd className="hidden rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">⌘ K</kbd></label><div className="flex rounded-xl border border-slate-200 bg-white p-1"><button onClick={() => changeLayout('grid')} aria-label="Grid view" aria-pressed={layout === 'grid'} className={`rounded-lg p-2 ${layout === 'grid' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><Grid2X2 size={17} /></button><button onClick={() => changeLayout('list')} aria-label="List view" aria-pressed={layout === 'list'} className={`rounded-lg p-2 ${layout === 'list' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><List size={17} /></button><button onClick={() => changeLayout('tree')} aria-label="Tree View" title="Tree View" aria-pressed={layout === 'tree'} className={`rounded-lg p-2 ${layout === 'tree' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><GitBranch size={17} /></button></div></div>
          {selected.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2"><span className="mr-auto text-sm font-medium text-blue-800">{selected.length} selected</span>{view !== 'trash' && selectionOwned && <button onClick={() => { const selectedEntries = actionEntries.filter((item) => selected.includes(item.path) && owns(item)); const targets = selectedEntries.filter((entry) => !selectedEntries.some((parent) => parent.isFolder && entry.path.startsWith(`${parent.path}/`))); setDialog({ kind: 'move', entry: targets[0], entries: targets, value: folder }); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"><Move size={14} className="mr-1 inline" />Move</button>}{view !== 'trash' && <button onClick={() => void bulkDownload()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"><Download size={14} className="mr-1 inline" />Download</button>}{selectionOwned && <button onClick={() => void bulkDelete()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"><Trash2 size={14} className="mr-1 inline" />{view === 'trash' ? 'Delete forever' : 'Delete'}</button>}<button onClick={() => setSelected([])} aria-label="Clear selection" className="rounded-lg p-1.5 text-blue-700 hover:bg-blue-100"><X size={16} /></button></div>}
          {guest && <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-blue-600"><Globe size={16} /><span>Publicly shared content · Read-only</span><button className="underline" onClick={() => { setPublicFolder(null); onSearchTermChange(''); setSelected([]); }}>Public files</button>{publicFolder?.ancestors?.map((ancestor) => <button key={ancestor.id} className="underline" onClick={() => { setPublicFolder(ancestor); onSearchTermChange(''); setSelected([]); }}>{ancestor.name}</button>)}{publicFolder && <span>/ {publicFolder.name}</span>}<button title="Refresh" onClick={() => void load()}><RotateCcw size={16} /></button></div>}
          {error && <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
          {view === 'shared' && <div className="mb-3 flex items-center gap-3 text-sm"><button onClick={() => { setSharedFolder(''); setSharedOffset(0); setSelected([]); }} className="font-semibold text-blue-700">Shared with me</button>{sharedFolder && <span className="truncate text-slate-500">/ {sharedFolder.split('/').slice(1).join(' / ')}</span>}<button title="Refresh shared items" onClick={() => { if (sharedOffset === 0) void load(); else setSharedOffset(0); }} className="ml-auto rounded-lg p-2 text-blue-600"><RotateCcw size={16} /></button><span className="text-xs text-slate-500">Read-only</span></div>}
          {view === 'files' && crumbs.length > 0 && <button onClick={() => goTo(crumbs.slice(0, -1).join('/'))} className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-700"><ArrowLeft size={16} />Back to {crumbs.length > 1 ? crumbs[crumbs.length - 2] : 'My Files'}</button>}
          <section data-drag-active={dropActive} onDragOver={(event) => { event.preventDefault(); if (!guest) setDropActive(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false); }} onDrop={(event) => { event.preventDefault(); setDropActive(false); if (!guest && event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files); }} className={`fm-surface min-h-[450px] rounded-2xl border bg-white p-4 transition sm:p-5 ${dropActive ? 'border-blue-400 bg-blue-50/70 ring-4 ring-blue-100' : 'border-slate-200'}`}>
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-800">{isSearching ? `Search results for “${searchTerm.trim()}”` : view === 'shared' ? 'Shared with me' : view === 'trash' ? 'Recently deleted' : 'All items'}</h2><p className="mt-0.5 text-xs text-slate-400">{isSearching ? `${filtered.length}${searchHasMore ? '+' : ''} matching ${filtered.length === 1 ? 'item' : 'items'} across your accessible files` : view === 'shared' ? 'Files shared by other people appear here.' : `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`}</p></div>{!guest && view === 'files' && !isSearching && <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Plus size={15} />Add files</button>}</div>
            {(loading && !isSearching) || (isSearching && searchLoading && searchResults.length === 0) ? <div className="flex h-64 items-center justify-center text-blue-600"><LoaderCircle className="animate-spin" /></div> : filtered.length === 0 ? <EmptyState icon={view === 'trash' ? <Trash2 size={28} /> : view === 'favorites' ? <Star size={28} /> : <Folder size={28} />} title={isSearching ? 'No matching files' : guest ? publicFolder ? 'This public folder is empty' : 'No publicly shared files are available.' : view === 'shared' ? 'No shared items here' : view === 'trash' ? 'Trash is empty' : view === 'favorites' ? 'No favorites yet' : 'This folder is empty'} subtitle={guest ? 'Only content shared with Everyone is shown.' : isSearching ? 'Try another name or clear your search.' : view === 'files' ? 'Upload files or create a folder to get started.' : 'Items you add here will appear in this view.'} /> : (
              <>{layout === 'tree' ? <FileTree key={`${user?.id ?? "public"}:${view}:${folder}:${sharedFolder}:${publicFolder?.path ?? ""}:${isSearching}`} entries={filtered} userId={user?.id ?? ""} query={searchTerm} label={isSearching ? 'Search results' : title} renderEntry={renderFileEntry} onEntriesChange={setTreeEntries} onOpen={enterFolder} onSelect={(entry) => setSelected((current) => current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path])} selected={selected} /> : <div className={layout === 'grid' ? 'fm-compact-grid' : 'divide-y divide-slate-100'}>{filtered.map(renderFileEntry)}</div>}{isSearching && searchHasMore && <div className="mt-5 flex justify-center"><button disabled={searchLoading} onClick={() => void searchAllFiles(searchOffset)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">{searchLoading ? 'Loading…' : 'Load more results'}</button></div>}</>
            )}
            {view === 'files' && !isSearching && rootHasMore && <button disabled={rootPaging} onClick={() => void loadMoreRoot()} className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm text-blue-700 disabled:opacity-50">{rootPaging ? 'Loading…' : 'Load more items'}</button>}
            {!guest && (view === 'shared' || (view === 'files' && !folder)) && !isSearching && sharedHasMore && <button disabled={loading || rootPaging} onClick={() => { if (view === 'shared') setSharedOffset((offset) => offset + 50); else void loadMoreSharedRoot(); }} className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm text-blue-700 disabled:opacity-50">{loading || rootPaging ? 'Loading…' : 'Load more shared items'}</button>}
            {dropActive && <div className="pointer-events-none fixed inset-4 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-blue-400 bg-blue-600/10 text-xl font-semibold text-blue-800">Drop files to upload</div>}
          </section>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Access is controlled by the owner’s sharing settings.</span><span>{filtered.length} items</span></div>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />
        </main>
        {details && <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-sm overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl"><div className="mb-7 flex items-center justify-between"><h2 className="font-semibold text-slate-900">File details</h2><button onClick={() => setDetails(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><div className="mb-6 flex h-32 items-center justify-center rounded-2xl bg-slate-50">{fileIcon(details, 46)}</div><h3 className="break-all text-lg font-semibold text-slate-900">{details.name}</h3><p className="mt-1 text-sm text-slate-500">{kindLabel(details)}</p><div className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-100 px-4">{[['Size', details.isFolder ? '—' : formatSize(details.size)], ['Location', resultLocation(details)], ['Modified', dateLabel(details.updatedAt)], ...(guest ? [] : [['Owner', owns(details) ? user?.email ?? 'You' : 'Another user']]), ['Permissions', owns(details) ? shareIndicators[details.path] === 'everyone' ? 'Everyone (including guests)' : shareIndicators[details.path] ? 'Shared with users' : 'Private' : 'Shared · read-only'], ['Created', dateLabel(metadata.find((item) => item.object_path === details.path)?.created_at ?? details.updatedAt)]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3 text-sm"><span className="text-slate-500">{label}</span><span className="max-w-[190px] truncate text-right font-medium text-slate-800">{value}</span></div>)}</div><button onClick={() => void download(details)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16} />Download</button></aside>}
      </div>

      {shareEntry && <FileShareModal path={shareEntry.path} name={shareEntry.name} isFolder={shareEntry.isFolder} ownerEmail={user?.email ?? ''} onClose={() => setShareEntry(null)} onSaved={() => { setShareEntry(null); setShareVersion((value) => value + 1); }} />}

      {menu && <div onClick={(event) => event.stopPropagation()} style={{ left: menu.x, top: menu.y }} className="fm-menu fixed z-[70] w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{menuActions.map(([action, Icon, label]) => <button key={action} onClick={() => contextAction(action, menu.entry)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${action === 'delete' ? 'text-rose-600' : 'text-slate-700'}`}><Icon size={16} />{label}</button>)}</div>}

      {dialog && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form onSubmit={(event) => { event.preventDefault(); if (dialog.kind === 'folder') void createFolder(); else void performPathAction(); }} className="fm-dialog w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-900">{dialog.kind === 'folder' ? 'Create a folder' : dialog.kind === 'rename' ? 'Rename item' : dialog.kind === 'copy' ? 'Copy item' : 'Move item'}</h2><button type="button" onClick={() => setDialog(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mb-2 block text-sm font-medium text-slate-700">{dialog.kind === 'folder' || dialog.kind === 'rename' ? 'Name' : 'Destination folder path'}</label><input autoFocus value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} placeholder={dialog.kind === 'folder' ? 'New folder' : dialog.kind === 'rename' ? 'New name' : 'For example: Documents/Reports'} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /><p className="mt-2 text-xs text-slate-500">{dialog.kind === 'folder' ? 'New folders inherit sharing from their parent folder.' : 'Use a path relative to My Files. Leave empty for the root folder.'}</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Working…' : 'Continue'}</button></div></form></div>}

      {uploadOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && uploads.every((item) => item.state !== 'uploading')) setUploadOpen(false); }}><div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!guest && event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files); }} className="fm-dialog w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="mb-6 flex items-start justify-between"><div><h2 className="text-xl font-bold text-slate-900">Upload files</h2><p className="mt-1 text-sm text-slate-500">Add files to {folder.split('/')[folder.split('/').length - 1] || 'My Files'}</p></div><button onClick={() => setUploadOpen(false)} aria-label="Close upload dialog" className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button></div><button onClick={() => uploadInput.current?.click()} className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/60 px-6 py-10 text-center transition hover:border-blue-400 hover:bg-blue-50"><span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm"><Upload size={24} /></span><span className="font-semibold text-slate-800">Drop files here to upload</span><span className="mt-1 text-sm text-slate-500">or click to browse · multiple files supported</span></button><input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />{uploads.length > 0 && <div className="mt-5 max-h-52 space-y-2 overflow-y-auto">{uploads.map((item, index) => <div key={`${item.file.name}-${index}`} className="rounded-xl border border-slate-100 px-3 py-2.5"><div className="flex items-center gap-3"><File size={18} className="shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{item.file.name}</p><p className="text-xs text-slate-400">{item.message ?? (item.state === 'uploading' ? `${item.progress ?? 0}% · ` : '')}{formatSize(item.file.size)}</p></div>{item.state === 'uploading' ? <LoaderCircle className="animate-spin text-blue-600" size={18} /> : item.state === 'done' ? <Check className="text-emerald-500" size={18} /> : item.state === 'error' ? <X className="text-rose-500" size={18} /> : <span className="text-xs text-slate-400">Waiting</span>}</div>{item.state === 'uploading' && <div className="ml-8 mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${item.progress ?? 0}%` }} /></div>}</div>)}</div>}<div className="mt-6 flex justify-end"><button onClick={() => setUploadOpen(false)} disabled={uploads.some((item) => item.state === 'uploading')} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{uploads.length && uploads.every((item) => item.state === 'done' || item.state === 'error') ? 'Done' : 'Close'}</button></div></div></div>}

      {preview && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-3 sm:p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"><div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{preview.entry.name}</div><button onClick={() => void download(preview.entry)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Download"><Download size={17} /></button><button onClick={() => setPreview(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Close"><X size={18} /></button></div><div className="flex min-h-[300px] items-center justify-center overflow-auto bg-slate-100 p-3 sm:min-h-[500px]">{preview.entry.mimeType.startsWith('image/') ? <img src={preview.url} alt={preview.entry.name} className="max-h-[75vh] max-w-full object-contain" /> : preview.entry.mimeType.startsWith('video/') ? <video src={preview.url} controls className="max-h-[75vh] max-w-full" /> : preview.entry.mimeType === 'application/pdf' ? <iframe title={preview.entry.name} src={preview.url} className="h-[75vh] w-full rounded-lg bg-white" /> : preview.text !== undefined ? <pre className="max-h-[75vh] w-full overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-5 text-sm text-slate-800">{preview.text}</pre> : <div className="text-center"><div className="mb-3 flex justify-center">{fileIcon(preview.entry, 48)}</div><p className="font-semibold text-slate-800">Preview isn’t available</p><p className="mt-1 text-sm text-slate-500">{kindLabel(preview.entry)} · {formatSize(preview.entry.size)}</p><button onClick={() => void download(preview.entry)} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Download file</button></div>}</div></div></div>}
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex min-h-[360px] flex-col items-center justify-center px-4 text-center"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">{icon}</div><h3 className="font-semibold text-slate-800">{title}</h3><p className="mt-1 max-w-sm text-sm text-slate-400">{subtitle}</p></div>;
}

function FileCard({ entry, location, shareMode, layout, selected, onSelect, onOpen, onMenu, onRestore, onDelete }: { entry: Entry; location?: string; shareMode?: 'users' | 'everyone'; layout: 'grid' | 'list'; selected: boolean; onSelect: (event?: React.MouseEvent) => void; onOpen: () => void; onMenu: (event: React.MouseEvent) => void; onRestore: () => void; onDelete: () => void }) {
  const isTrash = !!entry.trashedAt;
  return <article data-selected={selected} data-folder={entry.isFolder} onContextMenu={onMenu} onClick={onOpen} className={layout === 'grid' ? `fm-card fm-card--grid group relative cursor-pointer rounded-xl border p-2.5 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md ${selected ? 'border-blue-300 bg-blue-50/60 ring-2 ring-blue-100' : 'border-slate-100 bg-white'}` : `fm-card fm-card--list group flex cursor-pointer items-center gap-3 px-2 py-3 transition hover:bg-slate-50 ${selected ? 'bg-blue-50' : ''}`}>
    {layout === 'grid' && <button onClick={(event) => onSelect(event)} aria-label={selected ? 'Deselect' : 'Select'} className={`absolute left-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border transition ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white/90 text-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:border-blue-500'}`}><Check size={14} /></button>}
    <div className={layout === 'grid' ? 'fm-icon-tile mb-2 flex h-16 items-center justify-center rounded-xl' : 'fm-icon-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-xl'}>{entry.mimeType.startsWith('image/') && !entry.isFolder && !isTrash ? <AuthenticatedThumbnail entry={entry} /> : fileIcon(entry, layout === 'grid' ? entry.isFolder ? 36 : 30 : 22)}</div>
    <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5"><p className="truncate text-sm font-semibold text-slate-800" title={entry.name}>{entry.name}</p>{shareMode && <span title={shareMode === 'everyone' ? 'Shared with everyone (including guests)' : 'Shared with specific users'} className="shrink-0 text-blue-600">{shareMode === 'everyone' ? <Globe size={14} aria-label="Shared with everyone" /> : <Share2 size={14} aria-label="Shared with users" />}</span>}{entry.favorite && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}</div><p className="fm-item-kind mt-1 truncate text-xs text-slate-400">{kindLabel(entry)}{!entry.isFolder ? ` · ${formatSize(entry.size)}` : ''}</p>{location && <p className="mt-1 truncate text-[11px] text-blue-600" title={location}>{location}</p>}{layout === 'list' && !location && <p className="fm-item-modified mt-1 hidden text-xs text-slate-400 sm:block">Modified {dateLabel(entry.updatedAt)}</p>}</div>
    {layout === 'grid' && <p className="truncate text-[11px] text-slate-400">{dateLabel(entry.updatedAt)}</p>}
    {layout === 'list' && <><span className="hidden w-32 text-xs text-slate-500 md:block">{entry.isFolder ? '—' : formatSize(entry.size)}</span><span className="hidden w-32 text-xs text-slate-500 lg:block">{dateLabel(entry.updatedAt)}</span><button onClick={(event) => { event.stopPropagation(); onSelect(event); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Select item"><Check size={16} /></button></>}
    {isTrash ? <div className="ml-1 flex shrink-0 gap-1"><button onClick={(event) => { event.stopPropagation(); onRestore(); }} title="Restore" className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"><RotateCcw size={16} /></button><button onClick={(event) => { event.stopPropagation(); onDelete(); }} title="Delete forever" className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button></div> : <button onClick={(event) => { event.stopPropagation(); onMenu(event); }} onContextMenu={onMenu} className="ml-1 shrink-0 rounded-lg p-2 text-slate-400 opacity-100 hover:bg-slate-100 hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={`Actions for ${entry.name}`}><MoreHorizontal size={17} /></button>}
  </article>;
}

function AuthenticatedThumbnail({ entry }: { entry: Entry }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    downloadFile(entry).then(({ data }) => {
      if (active && data) { objectUrl = URL.createObjectURL(data); setUrl(objectUrl); }
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entry]);
  return url ? <img src={url} alt={entry.name} className="h-full w-full rounded-xl object-cover" /> : <FileImage size={38} className="text-fuchsia-300" />;
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
