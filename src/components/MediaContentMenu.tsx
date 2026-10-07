import { useContext, useRef, useState } from 'react';
import { Download, Eye, Globe, Link, Lock, Pencil, Share2, Trash2 } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { resolveBucketPath } from '@/lib/storageSettings';
import { getPlayableUrl, type Photo, type Video } from '@/lib/types';
import { deleteMedia } from '@/lib/deleteMedia';
import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { useGuardedClose } from '@/hooks/useGuardedClose';
import { ContentContextMenu, type ContentAction } from './ContentContextMenu';
import { TemporaryShareModal } from './TemporaryShareModal';
import { TaskModal } from './TaskModal';
import { EditVideoModal } from './EditVideoModal';
import { EditPhotoModal } from './EditPhotoModal';

export function MediaContentMenu({ kind, item, onPreview, onEdit, onDelete, onChanged }: {
  kind: 'video' | 'photo'; item: Video | Photo; onPreview: () => void; onEdit?: () => void; onDelete?: () => void; onChanged?: () => void;
}) {
  const user = useContext(AuthContext)?.user;
  const owned = !!user && user.id === item.owner_id;
  const ready = kind === 'photo' || (item as Video).processing_status === 'ready';
  const [dialog, setDialog] = useState<'edit' | 'rename' | 'share' | 'temporary' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const { requestDelete } = useDeleteConfirmation();
  const changed = () => { onChanged?.(); window.dispatchEvent(new CustomEvent('media-uploaded', { detail: kind })); };
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete this action. Please try again.'); }
    finally { running.current = false; setBusy(false); }
  };
  const download = async () => {
    if (kind === 'video') {
      const { data: { session } } = await supabase.auth.getSession();
      const url = await getPlayableUrl(item.id, session?.access_token);
      if (!url) throw new Error('Video unavailable.');
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not download the video.');
      saveBlob(await response.blob(), item.file_name);
    } else {
      const path = await resolveBucketPath(item.storage_path, 'images');
      const { data, error } = await supabase.storage.from('user-images').download(path);
      if (error || !data) throw new Error('Could not download the photo.');
      saveBlob(data, item.file_name);
    }
  };
  const visibility = async () => {
    if (!owned) return;
    const { error } = await supabase.from(kind === 'video' ? 'videos' : 'photos').update({ visibility: item.visibility === 'public' ? 'private' : 'public' }).eq('id', item.id).eq('owner_id', user!.id);
    if (error) throw new Error('Could not change visibility.');
    changed();
  };
  const remove = () => {
    if (onDelete) { onDelete(); return; }
    if (!owned) return;
    void requestDelete({ title: `Delete ${kind}`, message: `Permanently delete "${item.file_name}"?`,
      details: kind === 'video' ? 'The video, stored versions, preview and reactions will be permanently deleted.' : 'The photo, preview, thumbnail and reactions will be permanently deleted.',
      onConfirm: async () => { await deleteMedia(kind, item, user!.id); changed(); } });
  };
  const actions: ContentAction[] = [{ id: 'preview', label: kind === 'video' ? 'Play' : 'Preview', icon: <Eye size={16} />, disabled: !ready || busy, run: onPreview }];
  if (owned) actions.push(
    { id: 'edit', label: 'Edit', icon: <Pencil size={16} />, disabled: busy, run: () => onEdit ? onEdit() : setDialog('edit') },
    { id: 'rename', label: 'Rename', icon: <Pencil size={16} />, disabled: busy, run: () => setDialog('rename') },
    { id: 'share', label: 'Share', icon: <Share2 size={16} />, disabled: busy, run: () => setDialog('share') },
    { id: 'temporary', label: 'Create 24-hour share link', icon: <Link size={16} />, disabled: !ready || busy, run: () => setDialog('temporary') },
    { id: 'visibility', label: item.visibility === 'public' ? 'Make private' : 'Make public', icon: item.visibility === 'public' ? <Lock size={16} /> : <Globe size={16} />, disabled: busy, run: () => {
      if (item.visibility === 'public') void requestDelete({ title: 'Remove public access', message: `Make "${item.file_name}" private?`, details: 'This item will leave the public library. Temporary links remain valid until revoked or expired.', confirmLabel: 'Make private', onConfirm: visibility });
      else void run(visibility);
    } });
  actions.push({ id: 'download', label: 'Download', icon: <Download size={16} />, disabled: !ready || busy, run: () => void run(download) });
  if (owned) actions.push({ id: 'delete', label: 'Delete', icon: <Trash2 size={16} />, danger: true, disabled: busy, run: remove });
  return <>
    <ContentContextMenu name={item.file_name} actions={actions} className="content-menu-card" />
    {error && <TaskModal aria-label="Content action failed" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4"><div className="content-task-panel"><h2>Action failed</h2><p role="alert">{error}</p><button onClick={() => setError('')}>Close</button></div></TaskModal>}
    {owned && dialog === 'temporary' && <TemporaryShareModal target={{ type: kind, id: item.id, name: item.file_name }} onClose={() => setDialog(null)} />}
    {owned && dialog === 'edit' && <div className="mg-dialog">{kind === 'video' ? <EditVideoModal video={item as Video} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed(); }} /> : <EditPhotoModal photo={item as Photo} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed(); }} />}</div>}
    {owned && (dialog === 'rename' || dialog === 'share') && <MediaNameOrShareModal kind={kind} item={item} mode={dialog} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed(); }} />}
  </>;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MediaNameOrShareModal({ kind, item, mode, onClose, onSaved }: { kind: 'video' | 'photo'; item: Photo | Video; mode: 'rename' | 'share'; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item.file_name);
  const [visibility, setVisibility] = useState(item.visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const { requestDelete } = useDeleteConfirmation();
  const close = useGuardedClose(onClose, name !== item.file_name || visibility !== item.visibility, busy);
  const save = async () => {
    if (running.current) return;
    if (mode === 'rename' && (!name.trim() || /[\\/\p{Cc}]/u.test(name) || new TextEncoder().encode(name.trim()).length > 255)) { setError('Choose a valid name without path separators (up to 255 bytes).'); return; }
    running.current = true; setBusy(true); setError('');
    try {
      const { data, error } = await supabase.from(kind === 'video' ? 'videos' : 'photos').update(mode === 'rename' ? { file_name: name.trim() } : { visibility }).eq('id', item.id).eq('owner_id', item.owner_id).select('id').single();
      if (error || !data) throw new Error(error?.code === '23505' ? 'An item with that name already exists.' : 'Could not save changes. Please try again.');
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save changes.'); throw cause; }
    finally { running.current = false; setBusy(false); }
  };
  return <TaskModal aria-label={mode === 'rename' ? 'Rename content' : 'Share content'} className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4"><form className="content-task-panel" onSubmit={event => {
    event.preventDefault();
    if (mode === 'share' && item.visibility === 'public' && visibility === 'private') void requestDelete({ title: 'Remove public access', message: `Make "${item.file_name}" private?`, details: 'This item will leave the public library. Temporary links remain valid until revoked or expired.', confirmLabel: 'Save sharing', onConfirm: save });
    else void save().catch(() => {});
  }}>
    <h2>{mode === 'rename' ? 'Rename' : 'Share'} {kind}</h2>
    {mode === 'rename' ? <label>Name<input autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label> : <><p>Choose who can view "{item.file_name}". Public content appears in the public library.</p><label>Visibility<select className="ml-3 rounded-lg border p-2" disabled={busy} value={visibility} onChange={event => setVisibility(event.target.value as 'public' | 'private')}><option value="private">Private — only you</option><option value="public">Public — everyone</option></select></label><p>For access that expires, use Create 24-hour share link from the card menu.</p></>}
    {error && <p role="alert">{error}</p>}
    <div className="mt-4 flex justify-end"><button type="button" disabled={busy} onClick={close}>Cancel</button><button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
  </form></TaskModal>;
}
