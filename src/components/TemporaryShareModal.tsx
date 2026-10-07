import { useEffect, useMemo, useRef, useState } from 'react';
import { TaskModal } from './TaskModal';
import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { createTemporaryLink, getTemporaryLink, revokeTemporaryLink, type ShareTarget, type TemporaryLink } from '@/lib/temporaryShares';

export function TemporaryShareModal({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const stableTarget = useMemo(() => ({ type: target.type, id: target.id, name: target.name }), [target.type, target.id, target.name]);
  const [link, setLink] = useState<TemporaryLink | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const locked = useRef(false);
  const { requestDelete } = useDeleteConfirmation();
  useEffect(() => {
    let active = true;
    getTemporaryLink(stableTarget).then(result => { if (active) { setLink(result); setLoaded(true); } }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [stableTarget]);
  const generate = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { setLink(await createTemporaryLink(target, link?.id)); setCopied(false); }
    finally { locked.current = false; setBusy(false); }
  };
  const create = () => {
    if (link) void requestDelete({ title: 'Replace temporary link', message: `Replace the temporary link for "${target.name}"?`, details: 'The previous link will stop working immediately.', confirmLabel: 'Create new link', onConfirm: generate });
    else void generate().catch(cause => setError(cause.message));
  };
  const revoke = () => {
    if (!link) return;
    const id = link.id;
    void requestDelete({ title: 'Revoke temporary link', message: `Revoke the temporary link for "${target.name}"?`, details: 'Anyone using this link will lose access immediately. Normal sharing settings stay the same.', confirmLabel: 'Revoke', onConfirm: async () => { await revokeTemporaryLink(id); setLink(null); } });
  };
  return <TaskModal aria-label="Temporary Share Link" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4">
    <div className="content-task-panel"><h2>Temporary Share Link</h2><p className="break-words">{target.name}</p>
      <p>Anyone with this link can access {target.type === 'folder' ? 'this folder and its contents' : 'this item'} for 24 hours. Normal Private/Public settings stay the same.</p>
      {link?.url && <input aria-label="Temporary share URL" readOnly value={link.url} onFocus={event => event.target.select()} />}
      {link && <p>Valid until: <time dateTime={link.expires_at}>{new Date(link.expires_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })}</time></p>}
      {link && !link.url && <p>An active link exists. Its secure token cannot be retrieved. Create a new link to replace it, or revoke it.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end">
        <button disabled={busy} onClick={onClose}>Close</button>
        {link?.url && <button disabled={busy} onClick={() => void navigator.clipboard.writeText(link.url!).then(() => setCopied(true)).catch(() => setError('Could not copy. Select the URL and copy it manually.'))}>{copied ? 'Copied' : 'Copy Link'}</button>}
        {link && <button disabled={busy} onClick={revoke}>Revoke</button>}
        <button disabled={busy || !loaded} onClick={create}>{busy ? 'Loading…' : link ? 'Create new link' : 'Create 24-hour share link'}</button>
      </div>
    </div>
  </TaskModal>;
}
