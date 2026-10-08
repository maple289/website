import { TaskModal } from './TaskModal';
import { ContentContextMenu, type ContentAction } from './ContentContextMenu';
import { TemporaryShareModal } from './TemporaryShareModal';
import { FolderDestinationPicker } from './FolderDestinationPicker';
import { useFileClipboard } from '@/context/FileClipboardContext';
import { copyName, executeFileOperation, planFileOperation, type FileOperationPlan } from '@/lib/fileOperations';
import { downloadFolderArchive } from '@/lib/folderDownloads';
import { FilePreview } from './FilePreview';
import { recordFileEvent } from '@/lib/analytics';
import { FileTypeIcon } from './FileTypeIcon';
import { fileCategory, fileCategoryLabels } from '@/lib/fileTypes';
import { filePreviewKind } from '@/lib/filePreviews';
import { useGuardedClose } from '@/hooks/useGuardedClose';
import { useDeleteConfirmation, type DeleteConfirmation } from '@/lib/deleteConfirmation';
import { FileDropArea } from '@/components/FileDropArea';
import { uploadObject } from '@/lib/mediaUploads';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as tus from 'tus-js-client';
import {
  ArrowLeft, Check, ChevronRight, Clock3, Cloud, Copy, Download, Eye,
  Folder, FolderPlus, Globe, Grid2X2, GitBranch, HardDrive, Info, Link, List, LoaderCircle, ClipboardPaste,
  Move, Pencil, Plus, RotateCcw, Search, Share2, Star, Trash2, Upload, X,
} from 'lucide-react';
import { supabase, supabaseAnonKey } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { FileShareModal } from '@/components/FileShareModal';
import './FileManager.css';
import { downloadFile, loadPublicFiles } from '@/lib/publicFiles';
import { FileTree } from '@/components/FileTree';
import { FileVideoThumbnail } from '@/components/FileVideoThumbnail';
import { ancestorPaths, metadataColumns, getFileMetadataTree, loadFileChildren, fromMetadata, type FileEntry, type FileMetadata } from '@/lib/fileTree';

import { useFileNavigation } from '@/hooks/useFileNavigation';
type Entry = FileEntry;
type Metadata = FileMetadata;
type UploadItem = { file: File; state: 'waiting' | 'uploading' | 'done' | 'error'; message?: string; progress?: number };
type SearchRow = { object_path: string; name: string; location: string; is_folder: boolean; file_size: number; mime_type: string; updated_at: string; is_favorite: boolean };

const BUCKET = 'user-files';
const SEARCH_PAGE_SIZE = 50;
const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;
const dateLabel = (value: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const kindLabel = (entry: Entry) => fileCategoryLabels[fileCategory(entry)];
const fileIcon = (entry: Entry, size = 24) => <FileTypeIcon entry={entry} size={size} />;

export function FileManager({ searchTerm, onSearchTermChange, publicOnly = false }: { searchTerm: string; onSearchTermChange: (value: string) => void; publicOnly?: boolean }) {
  const { user: authenticatedUser } = useAuth();
  // Public browsing always uses the public RPC, including for signed-in owners.
  // This scope also keeps tree loading, search and management controls read-only.
  const user = publicOnly ? null : authenticatedUser;
  const { requestDelete } = useDeleteConfirmation();
  const guest = !user;
  const [shareEntry, setShareEntry] = useState<Entry | null>(null);
  const [temporaryEntry, setTemporaryEntry] = useState<Entry | null>(null);
  const { clipboard, copy, clear: clearClipboard } = useFileClipboard();
  const [conflict, setConflict] = useState<{ entry: Entry; destination: string; resolve: (choice: 'keep' | 'replace' | 'cancel') => void } | null>(null);
  const [actionError, setActionError] = useState('');
  const operationLock = useRef(false);
  const downloading = useRef(false);
  const pendingPlans = useRef(new Map<string, FileOperationPlan>());
  const completedTargets = useRef(new Set<string>());
  const pendingReplacements = useRef(new Map<string, DeleteConfirmation>());
  const [shareIndicators, setShareIndicators] = useState<Record<string, 'users' | 'everyone'>>({});
  const [shareVersion, setShareVersion] = useState(0);
  const [sharedOffset, setSharedOffset] = useState(0);
  const [sharedHasMore, setSharedHasMore] = useState(false);
  const [sharedCrumbs, setSharedCrumbs] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
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
  const [preview, setPreview] = useState<Entry | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialogState] = useState<{ kind: 'folder' | 'rename' | 'move' | 'copy' | 'restore'; entry?: Entry; entries?: Entry[]; value: string; initialValue?: string } | null>(null);
  const setDialog = (next: typeof dialog) => {
    if (!next || next.initialValue === undefined) { pendingPlans.current.clear(); pendingReplacements.current.clear(); completedTargets.current.clear(); setActionError(''); }
    setDialogState(next ? { ...next, initialValue: next.initialValue ?? next.value } : null);
  };
  const closeDialog = useGuardedClose(() => setDialog(null), !!dialog && dialog.value !== dialog.initialValue, busy);

  const fileInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const latestSearchTerm = useRef(searchTerm);
  const listingState = useRef({ version: 0 });
  const uploadingBatch = useRef(false);

  const { view, folder, sharedFolder, publicFolder, navigate, back, forward } = useFileNavigation(guest, () => {
    listingState.current.version++;
    setEntries([]); setTreeEntries([]); setSelected([]); setMenu(null); setDetails(null); setPreview(null);
    setSharedOffset(0); setSharedHasMore(false); setRootHasMore(false); setLoading(true);
    onSearchTermChange('');
  }, publicOnly ? '#/public-files' : '#/files');
  const goTo = (path: string) => navigate({ folder: path });

  useEffect(() => {
    setSharedCrumbs([]);
    if (guest || !sharedFolder) return;
    const paths = [...ancestorPaths(sharedFolder), sharedFolder];
    const controller = new AbortController();
    // RLS filters inaccessible parent folders out of the shared breadcrumb.
    void supabase.from('user_file_metadata').select(metadataColumns).in('object_path', paths)
      .eq('is_folder', true).is('trashed_at', null).abortSignal(controller.signal).then(({ data, error: pathError }) => {
        if (!controller.signal.aborted && !pathError) setSharedCrumbs((data ?? []).map((row) => row.object_path).sort((a, b) => a.split('/').length - b.split('/').length));
      });
    return () => controller.abort();
  }, [guest, sharedFolder]);

  useEffect(() => {
    const onBackspace = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key !== 'Backspace' || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      if (dialog || preview || uploadOpen || shareEntry || details) return;
      event.preventDefault();
      window.history.back();
    };
    window.addEventListener('keydown', onBackspace);
    return () => window.removeEventListener('keydown', onBackspace);
  }, [dialog, preview, uploadOpen, shareEntry, details]);

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
      const metaRows: Metadata[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: rows, error: metaError } = await supabase.rpc('file_manager_metadata', { p_folder: folder, p_view: view, p_offset: offset });
        if (version !== listingState.current.version) return;
        if (metaError) throw metaError;
        metaRows.push(...((rows ?? []) as Metadata[]));
        if ((rows?.length ?? 0) < 1000) break;
      }
      const { data: bytes, error: bytesError } = await supabase.rpc('file_manager_storage_bytes');
      if (version !== listingState.current.version) return;
      if (bytesError) throw bytesError;
      setTotalBytes(Number(bytes ?? 0));
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
    return fromMetadata(item);
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
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus(); }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);


  const isSearching = Boolean(searchTerm.trim());
  const filtered = useMemo(() => isSearching ? searchResults : entries, [entries, isSearching, searchResults]);
  // Trash metadata is loaded across every page; search/tree selections must not
  // narrow an explicitly confirmed Delete All operation.
  const allTrashEntries = useMemo(() => view === 'trash'
    ? metadata.filter((item) => item.trashed_at).map(fromMetadata) : [], [metadata, view]);
  const actionEntries = layout === 'tree' ? treeEntries : filtered;
  const owns = (entry: Entry) => entry.path.startsWith(`${user?.id}/`);
  const canPaste = !!user && !!clipboard && clipboard.owner === user.id && view === 'files' && !isSearching && !busy;
  useEffect(() => {
    if (!clipboard || !user || clipboard.owner !== user.id) return;
    let active = true;
    void supabase.rpc('valid_file_clipboard', { p_path: clipboard.entry.path }).then(({ data, error }) => {
      if (active && !error && data === false) clearClipboard();
    });
    return () => { active = false; };
  }, [clipboard, user, searchRevision, clearClipboard]);
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
  const crumbs = folder ? folder.split('/') : [];
  const title = guest ? publicFolder?.name ?? 'Public Files Library' : view === 'files' ? folder ? 'My Files' : 'All files' : view === 'recent' ? 'Recent' : view === 'favorites' ? 'Favorites' : view === 'shared' ? 'Shared' : 'Trash';

  const register = async (path: string, isFolder: boolean, favorite = false, fileSize = 0, mimeType = '') => {
    const { error: dbError } = await supabase.from('user_file_metadata').upsert({ owner_id: user!.id, object_path: path, is_folder: isFolder, is_favorite: favorite, file_size: fileSize, mime_type: mimeType, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,object_path' });
    if (dbError) throw dbError;
  };
  const enterFolder = (entry: Entry) => {
    if (!entry.isFolder) { void openPreview(entry); return; }
    onSearchTermChange('');
    if (guest) { navigate({ publicFolder: entry }); return; }
    if (owns(entry)) goTo(entry.path.split('/').slice(1).join('/'));
    else navigate({ view: 'shared', sharedFolder: entry.path });
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

  const openPreview = (entry: Entry) => { if (!entry.isFolder) setPreview(entry); };

  const download = async (entry: Entry) => {
    if (downloading.current || operationLock.current) return;
    downloading.current = true; setBusy(true);
    try {
      const result = entry.isFolder ? { data: await downloadFolderArchive(entry, user?.id ?? ''), error: null } : await downloadFile(entry);
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'File unavailable');
      const url = URL.createObjectURL(result.data); const link = document.createElement('a'); link.href = url; link.download = entry.name + (entry.isFolder ? '.zip' : ''); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      recordFileEvent(entry, 'download');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not download this item.'); }
    finally { downloading.current = false; setBusy(false); }
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
    // Storage's catalog trigger creates metadata in the same transaction.
    setDialog(null); await load();
    setBusy(false);
  };
  const latestLoad = useRef(load); latestLoad.current = load;
  const uploadFiles = async (files: FileList | File[]) => {
    if (view === 'shared') { setError('Shared folders are read-only.'); return; }
    const chosen = Array.from(files);
    if (!chosen.length || !user) return;
    if (uploadingBatch.current) { setError('Please wait for the current upload batch to finish.'); return; }
    uploadingBatch.current = true;
    // Capture the destination once; browser navigation cannot redirect this batch.
    const destination = `${user.id}/${folder ? `${folder}/` : ''}`;
    const offset = uploads.length;
    setUploadOpen(true); setUploads((current) => [...current, ...chosen.map((file) => ({ file, state: 'waiting' as const }))]);
    try {
      for (const [index, file] of chosen.entries()) {
        const itemIndex = offset + index;
        const update = (patch: Partial<UploadItem>) => setUploads((current) => current.map((item, i) => i === itemIndex ? { ...item, ...patch } : item));
        update({ state: 'uploading', progress: 0 });
        const path = destination + file.name;
        try {
          if (!file.name || /[\\/]/.test(file.name) || ['.', '..', '.folder', '.keep'].includes(file.name)) throw new Error('Choose a valid file name.');
          if (file.size > 10 * 1024 * 1024 * 1024) throw new Error('Files must be 10 GB or smaller.');
          if (file.size > 6 * 1024 * 1024) await uploadLargeFile(file, path, (progress) => update({ progress: Math.min(progress, 99) }));
          else {
            const { error: uploadError } = await uploadObject(BUCKET, path, file, file.type || 'application/octet-stream', (progress) => update({ progress: Math.min(progress, 99) }));
            if (uploadError) throw new Error(uploadError.message);
          }
          // The server commits metadata with the Storage object. A lost browser
          // response must never compensate by deleting a possibly saved file.
          recordFileEvent({ path }, 'upload');
          update({ state: 'done', progress: 100 });
          await latestLoad.current();
        } catch (cause) {
          update({ state: 'error', message: cause instanceof Error ? cause.message : 'Upload failed. Please try again.' });
          await latestLoad.current();
        }
      }
    } finally { uploadingBatch.current = false; }
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
  const trashEntry = async (item: Entry) => {
    if (!user || !owns(item)) throw new Error('You do not have permission to delete this item.');
    const affectedPaths = (await getFileMetadataTree(item, user.id)).map((row) => row.object_path);
    if (!affectedPaths.includes(item.path)) { await register(item.path, item.isFolder, item.favorite, item.size, item.mimeType); affectedPaths.push(item.path); }
    await changeMetadata(affectedPaths, new Date().toISOString());
  };
  const restoreEntry = (entry: Entry) => {
    if (!user || busy || !owns(entry)) return;
    const destination = entry.trashOriginalPath ?? entry.path;
    const value = destination.split('/').slice(1, -1).join('/');
    const operation = { kind: 'restore' as const, entry, value, initialValue: value };
    setDialog(operation);
    void performPathAction(operation);
  };
  const permanentDelete = async (entry: Entry) => {
    if (!user || !owns(entry)) throw new Error('You do not have permission to delete this item.');
    const rows = await getFileMetadataTree(entry, user.id);
    const current = rows.find((row) => row.object_path === entry.path);
    // Recheck saved Trash state after confirmation, including on a partial retry.
    // A restored/replaced item at the same path must never be deleted as Trash.
    if (!current) {
      if (rows.length) throw new Error('The folder has changed. Refresh Trash before deleting it.');
      return;
    }
    if (!current.trashed_at || current.trashed_at !== entry.trashedAt || current.is_folder !== entry.isFolder || rows.some((row) => !row.trashed_at)) {
      throw new Error('This item or part of its contents is no longer in Trash. Refresh Trash before deleting it.');
    }
    const paths = entry.isFolder ? await listTree(entry.path) : [entry.path];
    for (let offset = 0; offset < paths.length; offset += 1000) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths.slice(offset, offset + 1000));
      if (removeError) throw removeError;
    }
    // Keep the folder's row until descendant cleanup succeeds, so a retry can
    // still validate and finish the remaining tree after a metadata failure.
    const affectedPaths = rows.map((row) => row.object_path).sort((a, b) => b.length - a.length);
    await changeMetadata(affectedPaths);
  };
  const confirmDeleteEntries = (selectedItems: Entry[], emptyTrash = false) => {
    if (!user || busy || !selectedItems.length) return;
    if (selectedItems.some((entry) => !owns(entry))) { setError('You do not have permission to delete these items.'); return; }
    if (emptyTrash && (view !== 'trash' || loading || selectedItems.some((entry) => !entry.trashedAt))) return;
    const unique = [...new Map(selectedItems.map((entry) => [entry.path, entry])).values()];
    const folderPaths = new Set(unique.filter((entry) => entry.isFolder).map((entry) => entry.path));
    const items = unique.filter((entry) => !ancestorPaths(entry.path).some((path) => folderPaths.has(path)));
    const permanent = items.some((entry) => !!entry.trashedAt);
    const folders = items.some((entry) => entry.isFolder);
    const completed = new Set<string>();
    setMenu(null);
    void requestDelete({
      title: emptyTrash ? 'Delete all Trash contents' : permanent ? 'Permanently delete items' : 'Move to Trash',
      message: emptyTrash
        ? `Are you sure you want to permanently delete all ${unique.length} ${unique.length === 1 ? 'file or folder' : 'files and folders'} in your Trash?`
        : selectedItems.length === 1
        ? `Are you sure you want to delete ${items[0].isFolder ? 'the folder ' : ''}"${items[0].name}"?`
        : `Are you sure you want to delete these ${selectedItems.length} selected items?`,
      details: [folders ? 'Folders may contain files and subfolders. All of their contents are included in this action.' : '',
        emptyTrash ? 'All listed Trash items and their folder contents will be permanently deleted, including their sharing records and temporary share links. This cannot be undone. The count includes nested files and folders.'
          : permanent ? 'Items already in Trash will be permanently deleted, including their sharing records. This cannot be undone. Any other selected items will be moved to Trash.'
          : 'These items will be moved to Trash and will no longer be available to shared users. You can restore them from Trash.'].filter(Boolean).join(' '),
      confirmLabel: emptyTrash ? 'Delete All Forever' : permanent ? folders && selectedItems.length === 1 ? 'Delete Folder' : 'Delete forever' : 'Move to Trash',
      processingLabel: permanent ? 'Deleting…' : 'Moving to Trash…',
      onConfirm: async () => {
        setBusy(true);
        let current: Entry | undefined;
        try {
          for (const item of items) {
            if (completed.has(item.path)) continue;
            current = item;
            if (item.trashedAt) await permanentDelete(item); else await trashEntry(item);
            completed.add(item.path);
          }
          setSelected([]); setDetails(null); await load();
        } catch (cause) {
          // Refresh actual results after partial success, retaining failed targets.
          await load();
          setSelected(items.filter((item) => !completed.has(item.path)).map((item) => item.path));
          const reason = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Please try again.';
          throw new Error(`Unable to finish deleting "${current?.name ?? 'this item'}". ${completed.size ? `${completed.size} selected item(s) completed. ` : ''}${folders ? 'Some folder contents may already have changed. ' : ''}${reason} Retry to finish the remaining items.`);
        } finally { setBusy(false); }
      },
    });
  };
  const performPathAction = async (operation = dialog) => {
    if (!operation?.entry || !user || operationLock.current) return;
    const targets = operation.entries?.length ? operation.entries : [operation.entry];
    const targetFolder = operation.value.trim().replace(/^\/+|\/+$/g, '');
    if (targetFolder.split('/').includes('..')) { setActionError('That destination is not allowed.'); return; }
    const parentPath = targetFolder ? `${user.id}/${targetFolder}` : user.id;
    if (operation.kind === 'rename' && (!operation.value.trim() || /[\\/\p{Cc}]/u.test(operation.value))) { setActionError('Enter a valid name without slashes.'); return; }
    operationLock.current = true; setBusy(true); setActionError('');
    try {
      for (const entry of targets) {
        if (completedTargets.current.has(entry.path)) continue;
        const replacement = pendingReplacements.current.get(entry.path);
        if (replacement) {
          if (!await requestDelete(replacement)) return;
          pendingReplacements.current.delete(entry.path);
          continue;
        }
        const oldParent = entry.path.split('/').slice(0, -1).join('/');
        let nextPath = operation.kind === 'rename' ? `${oldParent}/${operation.value.trim()}` : `${parentPath}/${entry.name}`;
        const copying = operation.kind === 'copy';
        const restoring = operation.kind === 'restore';
        let plan = pendingPlans.current.get(entry.path) ?? await planFileOperation(entry, nextPath, copying, restoring);
        if (!plan) {
          const choice = await new Promise<'keep' | 'replace' | 'cancel'>(resolve => setConflict({ entry, destination: nextPath, resolve }));
          setConflict(null);
          if (choice === 'cancel') return;
          if (choice === 'keep') {
            const parent = nextPath.split('/').slice(0, -1).join('/');
            const name = nextPath.split('/').pop()!;
            for (let i = 1; i <= 10000; i++) {
              nextPath = `${parent}/${copyName(name, i, entry.isFolder)}`;
              plan = await planFileOperation(entry, nextPath, copying, restoring);
              if (plan) break;
            }
            if (!plan) throw new Error('Could not find an available name.');
          } else {
            if (nextPath === entry.path) throw new Error('Use Keep both to paste alongside the original.');
            const { data: existing, error: lookupError } = await supabase.from('user_file_metadata').select(metadataColumns).eq('owner_id', user.id).eq('object_path', nextPath).single();
            if (lookupError || !existing) throw new Error('The conflicting item changed. Please retry.');
            const replaced = entryFromMetadata(existing);
            const backupPath = `${nextPath} (replaced ${crypto.randomUUID()})`;
            const backupPlan = await planFileOperation(replaced, backupPath, false);
            if (!backupPlan) throw new Error('Could not preserve the existing item.');
            const backupEntry = { ...replaced, path: backupPath, name: backupPath.split('/').pop()! };
            let archived = false;
            let replacementPlan: FileOperationPlan | null = null;
            const confirmation: DeleteConfirmation = { title: 'Replace existing item', message: `Replace "${replaced.name}" in the destination?`,
              details: `${replaced.isFolder ? 'The existing folder and all its contents' : 'The existing file'} will be preserved under a unique name and moved to Trash. The incoming item will take its place.`, confirmLabel: 'Replace', processingLabel: 'Replacing…',
              onConfirm: async () => {
                try {
                  await executeFileOperation(backupPlan, user.id);
                  if (!archived) { await trashEntry(backupEntry); archived = true; }
                  replacementPlan ??= await planFileOperation(entry, nextPath, copying, restoring);
                  if (!replacementPlan) throw new Error('The destination changed. Cancel and choose Keep both.');
                  await executeFileOperation(replacementPlan, user.id);
                  completedTargets.current.add(entry.path);
                } finally { await load(); }
              } };
            pendingReplacements.current.set(entry.path, confirmation);
            const confirmed = await requestDelete(confirmation);
            if (!confirmed) return;
            pendingReplacements.current.delete(entry.path);
            continue;
          }
        }
        pendingPlans.current.set(entry.path, plan);
        await executeFileOperation(plan, user.id);
        completedTargets.current.add(entry.path);
      }
      if (targets.some(entry => clipboard?.entry.path === entry.path) && operation.kind !== 'copy') clearClipboard();
      setDialog(null); setSelected([]); await load();
    } catch (err) {
      await load();
      setActionError(`${err instanceof Error ? err.message : 'Could not complete that action.'} ${completedTargets.current.size ? `${completedTargets.current.size} item(s) completed. ` : ''}Retry to finish remaining steps.`);
    }
    finally { operationLock.current = false; setBusy(false); }
  };

  const paste = () => {
    if (!canPaste || !clipboard) return;
    const operation = { kind: 'copy' as const, entry: clipboard.entry, value: folder, initialValue: folder };
    setDialog(operation);
    void performPathAction(operation);
  };

  const bulkDownload = async () => { for (const path of selected) { const item = actionEntries.find((entry) => entry.path === path); if (item) await download(item); } };
  const bulkDelete = () => confirmDeleteEntries(actionEntries.filter((entry) => selected.includes(entry.path)));
  const contextAction = (action: string, entry: Entry) => {
    setMenu(null);
    if (action === 'open') enterFolder(entry);
    if (action === 'preview') void openPreview(entry);
    if (action === 'download') void download(entry);
    if (action === 'share' && owns(entry)) setShareEntry(entry);
    if (action === 'rename') setDialog({ kind: 'rename', entry, value: entry.name });
    if (action === 'move') setDialog({ kind: 'move', entry, value: folder });
    if (action === 'copy' && owns(entry)) copy(entry);
    if (action === 'paste') paste();
    if (action === 'temporary' && owns(entry)) setTemporaryEntry(entry);
    if (action === 'favorite') void toggleFavorite(entry);
    if (action === 'delete') confirmDeleteEntries([entry]);
    if (action === 'restore') void restoreEntry(entry);
    if (action === 'properties') setDetails(entry);
  };
  const actionsFor = (entry: Entry): ContentAction[] => {
    const action = (id: string, label: string, Icon: typeof Folder, danger = false): ContentAction => ({ id, label, icon: <Icon size={16} />, danger, disabled: busy, run: () => contextAction(id, entry) });
    if (entry.trashedAt) return owns(entry) ? [action('restore', 'Restore', RotateCcw), action('delete', 'Delete forever', Trash2, true)] : [];
    const actions = [action('open', entry.isFolder ? 'Open' : 'Preview', entry.isFolder ? Folder : Eye)];
    if (owns(entry)) actions.push(action('rename', 'Rename', Pencil), action('share', 'Share', Share2), action('temporary', 'Create 24-hour share link', Link), action('move', 'Move', Move), action('copy', 'Copy', Copy), { ...action('paste', 'Paste here', ClipboardPaste), disabled: !canPaste }, action('favorite', entry.favorite ? 'Remove from Favorites' : 'Add to Favorites', Star));
    actions.push(action('download', 'Download', Download));
    if (owns(entry)) actions.push(action('properties', 'Properties', Info), action('delete', 'Move to Trash', Trash2, true));
    return actions;
  };

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

  const renderFileEntry = (entry: Entry) => <FileCard key={entry.path} entry={entry} actions={actionsFor(entry)} shareMode={shareIndicators[entry.path]} location={guest || isSearching || view === 'shared' ? resultLocation(entry) : undefined} layout={layout === 'tree' ? 'list' : layout} selected={selected.includes(entry.path)} onSelect={(event) => { if (event) event.stopPropagation(); setSelected((current) => current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path]); }} onOpen={() => isSearching ? openSearchResult(entry) : enterFolder(entry)} onMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, entry }); }} />;

  return (
    <FileDropArea appearance="light" enabled={!guest && view === 'files' && !uploadOpen && !dialog && !preview && !shareEntry && !temporaryEntry && !details} onFiles={(files) => void uploadFiles(files)}>
    <div className="file-manager min-h-[calc(100vh-72px)] text-slate-800">
      <div className="mx-auto flex min-h-[calc(100vh-72px)] max-w-[1680px]">
        {!guest && <aside className="fm-sidebar hidden w-[248px] shrink-0 border-r border-slate-200 bg-white p-5 md:flex md:flex-col">
          <div className="mb-8 flex items-center gap-3 px-2"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><HardDrive size={21} /></div><div><p className="font-semibold text-slate-900">File Manager</p><p className="text-xs text-slate-500">Your private space</p></div></div>
          <nav className="space-y-1">
            {([['files', Folder, 'My Files'], ['recent', Clock3, 'Recent'], ['favorites', Star, 'Favorites'], ['shared', Share2, 'Shared'], ['trash', Trash2, 'Trash']] as const).map(([key, Icon, label]) => <button key={key} onClick={() => { navigate({ view: key }); }} data-active={view === key} className={`fm-nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${view === key ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Icon size={18} />{label}{key === 'trash' && metadata.some((item) => item.trashed_at) && <span className="ml-auto h-2 w-2 rounded-full bg-blue-500" />}</button>)}
          </nav>
          <div className="fm-storage mt-auto rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between text-sm font-semibold"><span className="flex items-center gap-2"><Cloud size={16} className="text-blue-600" />Storage</span><span className="text-xs text-slate-500">Private</span></div><p className="text-lg font-bold text-slate-900">{formatSize(totalBytes)}</p><p className="mt-1 text-xs text-slate-500">Used in File Manager</p><div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 text-[11px] text-slate-400"><HardDrive size={13} />Up to 10 GB per file</div></div>
        </aside>}
        <main className="fm-main min-w-0 flex-1 px-4 py-5 sm:px-7 lg:px-9">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">{!guest && view !== 'shared' && <div aria-label="Folder path" className="fm-breadcrumbs"><button onClick={() => { goTo(''); }} className="hover:text-blue-600">File Storage</button>{crumbs.map((part, index) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-2"><ChevronRight size={13} /><button className="max-w-32 truncate hover:text-blue-600" aria-current={index === crumbs.length - 1 ? 'page' : undefined} onClick={() => goTo(crumbs.slice(0, index + 1).join('/'))}>{part}</button></span>)}</div>}<h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">{view === 'files' && crumbs.length ? crumbs[crumbs.length - 1] : title}</h1></div>
            {!guest && view !== 'shared' && <div className="fm-header-actions flex min-w-0 flex-wrap items-center gap-2">
              <button onClick={back} title="Back" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 disabled:opacity-40 sm:flex"><ArrowLeft size={17} /></button>
              <button onClick={forward} title="Forward" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 disabled:opacity-40 sm:flex"><ChevronRight size={17} /></button>
              <button onClick={() => void load()} title="Refresh" className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700 sm:flex"><RotateCcw size={17} /></button>
              {view === 'trash' ? <button type="button" disabled={busy || loading || !!error || allTrashEntries.length === 0}
                onClick={() => confirmDeleteEntries(allTrashEntries, true)} title="Permanently delete all files and folders in your Trash"
                className="fluent-button fm-delete-all"><Trash2 size={19} aria-hidden="true" />Delete All</button> : <>
                {view === 'files' && <button type="button" disabled={!canPaste} onClick={paste}
                  title={isSearching ? 'Clear search to paste into the current folder' : clipboard ? `Paste "${clipboard.entry.name}" into ${folder || 'My Files'}` : 'Copy a file or folder first, then paste it here'}
                  className="fluent-button fluent-primary fm-paste-button"><ClipboardPaste size={20} aria-hidden="true" /><span>Paste</span></button>}
                <button onClick={() => setDialog({ kind: 'folder', value: '' })} disabled={busy} className="fluent-button fluent-secondary" title="New folder"><FolderPlus size={18} aria-hidden="true" /><span>New folder</span></button>
                <button onClick={() => { setUploads([]); setUploadOpen(true); }} disabled={busy} className="fluent-button fluent-primary"><Upload size={18} aria-hidden="true" />Upload</button>
              </>}
            </div>}
          </div>
          {!guest && <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 md:hidden">{([['files', Folder, 'My Files'], ['recent', Clock3, 'Recent'], ['favorites', Star, 'Favorites'], ['shared', Share2, 'Shared'], ['trash', Trash2, 'Trash']] as const).map(([key, Icon, label]) => <button key={key} onClick={() => { navigate({ view: key }); }} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${view === key ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}><Icon size={14} />{label}</button>)}</nav>}
          {!guest && view === 'files' && <div role="status" className={`fm-clipboard-status mb-3 ${clipboard ? 'is-ready' : ''}`}>
            <Copy size={17} aria-hidden="true" className="shrink-0" />
            {clipboard ? <div className="min-w-0"><p className="text-sm"><strong>Ready to paste:</strong> <span className="break-words" title={clipboard.entry.name}>{clipboard.entry.name}</span></p><p className="mt-0.5 text-xs">{isSearching ? 'Clear search to paste into the current folder.' : `Use Paste above to copy into ${folder || 'My Files'}.`}</p></div>
              : <p className="text-sm">Use <strong>Copy</strong> in a file or folder menu, then choose <strong>Paste</strong> above.</p>}
          </div>}
          <div className="fm-toolbar mb-5"><label className="fm-search flex h-11 min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"><Search size={17} className="shrink-0 text-slate-400" /><input ref={searchInput} value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} aria-label="Search files and folders" placeholder="Search files and folders" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" /><kbd className="hidden rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">⌘ K</kbd></label><div className="fm-view-switch flex rounded-xl border border-slate-200 bg-white p-1"><button onClick={() => changeLayout('grid')} title="Grid view" aria-label="Grid view" aria-pressed={layout === 'grid'} className={`rounded-lg p-2 ${layout === 'grid' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><Grid2X2 size={17} /></button><button onClick={() => changeLayout('list')} title="List view" aria-label="List view" aria-pressed={layout === 'list'} className={`rounded-lg p-2 ${layout === 'list' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><List size={17} /></button><button onClick={() => changeLayout('tree')} aria-label="Tree View" title="Tree View" aria-pressed={layout === 'tree'} className={`rounded-lg p-2 ${layout === 'tree' ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><GitBranch size={17} /></button></div></div>
          {selected.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2"><span className="mr-auto text-sm font-medium text-blue-800">{selected.length} selected</span>{view !== 'trash' && selectionOwned && <button onClick={() => { const selectedEntries = actionEntries.filter((item) => selected.includes(item.path) && owns(item)); const targets = selectedEntries.filter((entry) => !selectedEntries.some((parent) => parent.isFolder && entry.path.startsWith(`${parent.path}/`))); setDialog({ kind: 'move', entry: targets[0], entries: targets, value: folder }); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"><Move size={14} className="mr-1 inline" />Move</button>}{view !== 'trash' && <button onClick={() => void bulkDownload()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"><Download size={14} className="mr-1 inline" />Download</button>}{selectionOwned && <button onClick={() => void bulkDelete()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"><Trash2 size={14} className="mr-1 inline" />{view === 'trash' ? 'Delete forever' : 'Delete'}</button>}<button onClick={() => setSelected([])} aria-label="Clear selection" className="rounded-lg p-1.5 text-blue-700 hover:bg-blue-100"><X size={16} /></button></div>}
          {guest && <div aria-label="Public folder path" className="fm-breadcrumbs mb-4"><Globe size={16} /><span>Publicly shared content · Read-only</span><button className="underline" onClick={() => { navigate({}); }}>Public files</button>{publicFolder?.ancestors?.map((ancestor) => <button key={ancestor.id} className="underline" onClick={() => { navigate({ publicFolder: ancestor }); }}>{ancestor.name}</button>)}{publicFolder && <span>/ {publicFolder.name}</span>}<button title="Refresh" onClick={() => void load()}><RotateCcw size={16} /></button></div>}
          {error && <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
          {view === 'shared' && <div aria-label="Shared folder path" className="fm-breadcrumbs mb-3"><button onClick={() => { navigate({ view: 'shared' }); }} className="font-semibold text-blue-700">Shared with me</button>{sharedCrumbs.map((path) => <span key={path} className="flex min-w-0 items-center gap-1"><ChevronRight size={13} /><button title={path.split('/').pop()} aria-current={path === sharedFolder ? 'page' : undefined} className="max-w-36 truncate rounded-md px-1 py-1 hover:bg-blue-50" onClick={() => navigate({ view: 'shared', sharedFolder: path })}>{path.split('/').pop()}</button></span>)}<button title="Refresh shared items" onClick={() => { if (sharedOffset === 0) void load(); else setSharedOffset(0); }} className="ml-auto rounded-lg p-2 text-blue-600"><RotateCcw size={16} /></button><span className="text-xs text-slate-500">Read-only</span></div>}
          {view === 'files' && crumbs.length > 0 && <button onClick={() => goTo(crumbs.slice(0, -1).join('/'))} className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-700"><ArrowLeft size={16} />Back to {crumbs.length > 1 ? crumbs[crumbs.length - 2] : 'My Files'}</button>}
          <section className="fm-surface min-h-[450px] rounded-2xl border border-slate-200 bg-white p-4 transition sm:p-5">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-800">{isSearching ? `Search results for “${searchTerm.trim()}”` : view === 'shared' ? 'Shared with me' : view === 'trash' ? 'Recently deleted' : 'All items'}</h2><p className="mt-0.5 text-xs text-slate-400">{isSearching ? `${filtered.length}${searchHasMore ? '+' : ''} matching ${filtered.length === 1 ? 'item' : 'items'} across your accessible files` : view === 'shared' ? 'Files shared by other people appear here.' : `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`}</p></div>{!guest && view === 'files' && !isSearching && <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Plus size={15} />Add files</button>}</div>
            {(loading && !isSearching) || (isSearching && searchLoading && searchResults.length === 0) ? <div className="flex h-64 items-center justify-center text-blue-600"><LoaderCircle className="animate-spin" /></div> : filtered.length === 0 ? <EmptyState icon={view === 'trash' ? <Trash2 size={28} /> : view === 'favorites' ? <Star size={28} /> : <Folder size={28} />} title={isSearching ? 'No matching files' : guest ? publicFolder ? 'This public folder is empty' : 'No publicly shared files are available.' : view === 'shared' ? 'No shared items here' : view === 'trash' ? 'Trash is empty' : view === 'favorites' ? 'No favorites yet' : 'This folder is empty'} subtitle={guest ? 'Only content shared with Everyone is shown.' : isSearching ? 'Try another name or clear your search.' : view === 'files' ? 'Upload files or create a folder to get started.' : 'Items you add here will appear in this view.'} /> : (
              <>{layout === 'tree' ? <FileTree key={`${user?.id ?? "public"}:${view}:${folder}:${sharedFolder}:${publicFolder?.path ?? ""}:${isSearching}`} entries={filtered} userId={user?.id ?? ""} query={searchTerm} label={isSearching ? 'Search results' : title} renderEntry={renderFileEntry} onEntriesChange={setTreeEntries} onOpen={enterFolder} onSelect={(entry) => setSelected((current) => current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path])} selected={selected} /> : <div className={layout === 'grid' ? 'fm-compact-grid' : 'divide-y divide-slate-100'}>{filtered.map(renderFileEntry)}</div>}{isSearching && searchHasMore && <div className="mt-5 flex justify-center"><button disabled={searchLoading} onClick={() => void searchAllFiles(searchOffset)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">{searchLoading ? 'Loading…' : 'Load more results'}</button></div>}</>
            )}
            {view === 'files' && !isSearching && rootHasMore && <button disabled={rootPaging} onClick={() => void loadMoreRoot()} className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm text-blue-700 disabled:opacity-50">{rootPaging ? 'Loading…' : 'Load more items'}</button>}
            {!guest && (view === 'shared' || (view === 'files' && !folder)) && !isSearching && sharedHasMore && <button disabled={loading || rootPaging} onClick={() => { if (view === 'shared') setSharedOffset((offset) => offset + 50); else void loadMoreSharedRoot(); }} className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm text-blue-700 disabled:opacity-50">{loading || rootPaging ? 'Loading…' : 'Load more shared items'}</button>}
          </section>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Access is controlled by the owner’s sharing settings.</span><span>{filtered.length} {filtered.length === 1 ? 'item' : 'items'}</span></div>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />
        </main>
        {details && <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-sm overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl"><div className="mb-7 flex items-center justify-between"><h2 className="font-semibold text-slate-900">File details</h2><button onClick={() => setDetails(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><div className="mb-6 flex h-32 items-center justify-center rounded-2xl bg-slate-50">{fileIcon(details, 46)}</div><h3 className="break-all text-lg font-semibold text-slate-900">{details.name}</h3><p className="mt-1 text-sm text-slate-500">{kindLabel(details)}</p><div className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-100 px-4">{[['Size', details.isFolder ? '—' : formatSize(details.size)], ['Location', resultLocation(details)], ['Modified', dateLabel(details.updatedAt)], ...(guest ? [] : [['Owner', owns(details) ? user?.email ?? 'You' : 'Another user']]), ['Permissions', owns(details) ? shareIndicators[details.path] === 'everyone' ? 'Everyone (including guests)' : shareIndicators[details.path] ? 'Shared with users' : 'Private' : 'Shared · read-only'], ['Created', dateLabel(metadata.find((item) => item.object_path === details.path)?.created_at ?? details.updatedAt)]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3 text-sm"><span className="text-slate-500">{label}</span><span className="max-w-[190px] truncate text-right font-medium text-slate-800">{value}</span></div>)}</div><button onClick={() => void download(details)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16} />Download</button></aside>}
      </div>

      {shareEntry && <FileShareModal path={shareEntry.path} name={shareEntry.name} isFolder={shareEntry.isFolder} ownerEmail={user?.email ?? ''} onClose={() => setShareEntry(null)} onSaved={() => { setShareEntry(null); setShareVersion((value) => value + 1); }} />}
      {temporaryEntry && <TemporaryShareModal target={{ type: temporaryEntry.isFolder ? 'folder' : 'file', id: temporaryEntry.path, name: temporaryEntry.name }} onClose={() => setTemporaryEntry(null)} />}

      {menu && <ContentContextMenu name={menu.entry.name} actions={actionsFor(menu.entry)} anchor={menu} onClose={() => setMenu(null)} />}

      {conflict && <TaskModal aria-label="Name conflict" className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/50 p-4"><div className="content-task-panel"><h2>An item with this name already exists</h2><p>"{conflict.destination.split('/').pop()}" already exists in the destination. Choose how to continue.</p><p>Keep both creates a unique name. Replace preserves the existing item in Trash, including all contents of an existing folder.</p><div className="flex flex-wrap justify-end"><button onClick={() => conflict.resolve('cancel')}>Cancel</button><button onClick={() => conflict.resolve('keep')}>Keep both</button><button disabled={conflict.destination === conflict.entry.path || conflict.entry.path.startsWith(conflict.destination + "/")} onClick={() => conflict.resolve('replace')}>Replace</button></div></div></TaskModal>}

      {dialog && <TaskModal aria-label="File or folder action" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4">
        <form onSubmit={event => { event.preventDefault(); if (dialog.kind === 'folder') void createFolder(); else void performPathAction(); }} className="fm-dialog w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="mb-5 text-lg font-semibold text-slate-900">{dialog.kind === 'folder' ? 'Create a folder' : dialog.kind === 'rename' ? 'Rename item' : dialog.kind === 'copy' ? 'Paste item' : dialog.kind === 'restore' ? 'Restore item' : 'Move item'}</h2>
          {dialog.entry && <p className="mb-3 break-words text-sm text-slate-600">{dialog.entries?.length ? dialog.entries.length + ' selected items' : dialog.entry.name}{dialog.entry.isFolder ? ' (including all contents)' : ''}</p>}
          {(dialog.kind === 'folder' || dialog.kind === 'rename') && <>
            <label htmlFor="file-action-name" className="mb-2 block text-sm font-medium text-slate-700">Name</label>
            <input id="file-action-name" autoFocus disabled={busy || pendingPlans.current.size > 0 || pendingReplacements.current.size > 0 || completedTargets.current.size > 0} value={dialog.value} onChange={event => setDialog({ ...dialog, value: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" />
          </>}
          {(dialog.kind === 'copy' || dialog.kind === 'restore') && <p className="text-sm text-slate-600">Destination: My Files{dialog.value ? ' / ' + dialog.value : ''}</p>}
          {dialog.kind === 'move' && user && <FolderDestinationPicker owner={user.id} value={dialog.value} onChange={value => setDialog({ ...dialog, value })} sources={dialog.entries ?? (dialog.entry ? [dialog.entry] : [])} disabled={busy || pendingPlans.current.size > 0 || pendingReplacements.current.size > 0 || completedTargets.current.size > 0} />}
          {actionError && <p role="alert" className="mt-3 text-sm text-rose-700">{actionError}</p>}
          <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={closeDialog} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Working…' : 'Continue'}</button></div>
        </form>
      </TaskModal>}

      {uploadOpen && <TaskModal aria-label="Upload files" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4"><div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!guest && event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files); }} className="fm-dialog w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="mb-6 flex items-start justify-between"><div><h2 className="text-xl font-bold text-slate-900">Upload files</h2><p className="mt-1 text-sm text-slate-500">Add files to {folder.split('/')[folder.split('/').length - 1] || 'My Files'}</p></div><button disabled={uploads.some((item) => item.state === 'uploading' || item.state === 'waiting')} onClick={() => setUploadOpen(false)} aria-label="Close upload dialog" className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button></div><button disabled={uploads.some((item) => item.state === 'uploading' || item.state === 'waiting')} onClick={() => uploadInput.current?.click()} className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/60 px-6 py-10 text-center transition hover:border-blue-400 hover:bg-blue-50"><span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm"><Upload size={24} /></span><span className="font-semibold text-slate-800">Drop files here to upload</span><span className="mt-1 text-sm text-slate-500">or click to browse · multiple files supported</span></button><input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />{uploads.length > 0 && <div className="mt-5 max-h-52 space-y-2 overflow-y-auto">{uploads.map((item, index) => <div key={`${item.file.name}-${index}`} className="rounded-xl border border-slate-100 px-3 py-2.5"><div className="flex items-center gap-3"><FileTypeIcon entry={{ name: item.file.name, mimeType: item.file.type, isFolder: false }} size={22} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{item.file.name}</p><p className="text-xs text-slate-400">{item.state === 'done' ? 'Completed · ' : item.state === 'error' ? `Failed: ${item.message} · ` : item.state === 'uploading' ? `Uploading ${item.progress ?? 0}% · ` : 'Waiting · '}{formatSize(item.file.size)}</p></div>{item.state === 'uploading' ? <LoaderCircle className="animate-spin text-blue-600" size={18} /> : item.state === 'done' ? <Check className="text-emerald-500" size={18} /> : item.state === 'error' ? <X className="text-rose-500" size={18} /> : <span className="text-xs text-slate-400">Waiting</span>}</div>{item.state === 'uploading' && <div className="ml-8 mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${item.progress ?? 0}%` }} /></div>}</div>)}</div>}<div className="mt-6 flex justify-end"><button onClick={() => setUploadOpen(false)} disabled={uploads.some((item) => item.state === 'uploading' || item.state === 'waiting')} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{uploads.length && uploads.every((item) => item.state === 'done' || item.state === 'error') ? 'Done' : 'Close'}</button></div></div></TaskModal>}

      {preview && <FilePreview entry={preview} onClose={() => setPreview(null)} onDownload={() => void download(preview)} />}
    </div>
    </FileDropArea>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex min-h-[360px] flex-col items-center justify-center px-4 text-center"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">{icon}</div><h3 className="font-semibold text-slate-800">{title}</h3><p className="mt-1 max-w-sm text-sm text-slate-400">{subtitle}</p></div>;
}

function FileCard({ entry, actions, location, shareMode, layout, selected, onSelect, onOpen, onMenu }: { entry: Entry; actions: ContentAction[]; location?: string; shareMode?: 'users' | 'everyone'; layout: 'grid' | 'list'; selected: boolean; onSelect: (event?: React.MouseEvent) => void; onOpen: () => void; onMenu: (event: React.MouseEvent) => void }) {
  const isTrash = !!entry.trashedAt;
  const category = fileCategory(entry);
  return <article data-selected={selected} data-folder={entry.isFolder} onContextMenu={onMenu} onClick={onOpen} className={layout === 'grid' ? `fm-card fm-card--grid group relative cursor-pointer rounded-xl border p-2.5 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md ${selected ? 'border-blue-300 bg-blue-50/60 ring-2 ring-blue-100' : 'border-slate-100 bg-white'}` : `fm-card fm-card--list group flex cursor-pointer items-center gap-3 px-2 py-3 transition hover:bg-slate-50 ${selected ? 'bg-blue-50' : ''}`}>
    {layout === 'grid' && <button onClick={(event) => onSelect(event)} aria-label={selected ? 'Deselect' : 'Select'} className={`absolute left-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border transition ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white/90 text-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:border-blue-500'}`}><Check size={14} /></button>}
    <div className={layout === 'grid' ? 'fm-icon-tile relative mb-2 flex h-16 items-center justify-center rounded-xl' : 'fm-icon-tile relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl'}>{category === 'image' && !isTrash ? <AuthenticatedThumbnail entry={entry} /> : category === 'video' && !isTrash ? <FileVideoThumbnail entry={entry} /> : fileIcon(entry, layout === 'grid' ? entry.isFolder ? 36 : 30 : 24)}{(category === 'image' || category === 'video') && !isTrash && <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-white/95 p-0.5 shadow-sm"><FileTypeIcon entry={entry} size={14} /></span>}</div>
    <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5"><p className="fm-item-name truncate text-sm font-semibold text-slate-800" title={entry.name}>{entry.name}</p>{!isTrash && filePreviewKind(entry) && <span title="Preview available" className="shrink-0 text-slate-400"><Eye size={13} aria-label="Preview available" /></span>}{shareMode && <span title={shareMode === 'everyone' ? 'Shared with everyone (including guests)' : 'Shared with specific users'} className="shrink-0 text-blue-600">{shareMode === 'everyone' ? <Globe size={14} aria-label="Shared with everyone" /> : <Share2 size={14} aria-label="Shared with users" />}</span>}{entry.favorite && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}</div><p className="fm-item-kind mt-1 truncate text-xs text-slate-400">{kindLabel(entry)}{!entry.isFolder ? ` · ${formatSize(entry.size)}` : ''}</p>{location && <p className="mt-1 truncate text-[11px] text-blue-600" title={location}>{location}</p>}{layout === 'list' && !location && <p className="fm-item-modified mt-1 hidden text-xs text-slate-400 sm:block">Modified {dateLabel(entry.updatedAt)}</p>}</div>
    {layout === 'grid' && <p className="truncate text-[11px] text-slate-400">{dateLabel(entry.updatedAt)}</p>}
    {layout === 'list' && <><span className="hidden w-32 text-xs text-slate-500 md:block">{entry.isFolder ? '—' : formatSize(entry.size)}</span><span className="hidden w-32 text-xs text-slate-500 lg:block">{dateLabel(entry.updatedAt)}</span><button onClick={(event) => { event.stopPropagation(); onSelect(event); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Select item"><Check size={16} /></button></>}
    <ContentContextMenu name={entry.name} actions={actions} />
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
  return url ? <img src={url} alt={entry.name} className="h-full w-full rounded-xl object-cover" /> : <FileTypeIcon entry={entry} size={38} />;
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
