import { useEffect, useRef, useState } from 'react';
import { TaskModal } from './TaskModal';
import { MessengerPeople } from './MessengerPeople';
import { useGuardedClose } from '@/hooks/useGuardedClose';
import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { authenticatedRequest } from '@/lib/authSession';
import { supabase } from '@/lib/supabase';
import type { ChatUser } from '@/lib/messenger';
import type { Photo, Video } from '@/lib/types';
import './Messenger.css';

type Sharing = { users: ChatUser[]; groups: ChatUser[]; selected_groups: string[]; revision: string; visibility: 'public' | 'private' };
export function MediaShareModal({ kind, item, onClose, onSaved }: { kind: 'video' | 'photo'; item: Photo | Video; onClose: () => void; onSaved: () => void }) {
  const [initial, setInitial] = useState<Sharing | null>(null), [users, setUsers] = useState<ChatUser[]>([]), [groups, setGroups] = useState<string[]>([]);
  const [visibility, setVisibility] = useState(item.visibility), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), { requestDelete } = useDeleteConfirmation();
  const equal = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const dirty = !!initial && (visibility !== initial.visibility || !equal(users.map(p => p.id), initial.users.map(p => p.id)) || !equal(groups, initial.selected_groups));
  const close = useGuardedClose(onClose, dirty, busy);
  useEffect(() => { let active = true;
    void authenticatedRequest(() => supabase.rpc('media_sharing_rpc', { p_type: kind, p_id: item.id, p_action: 'get' })).then(({ data, error }) => {
      if (!active) return;
      if (error || !data || !Array.isArray(data.users) || !Array.isArray(data.groups) || !Array.isArray(data.selected_groups) || typeof data.revision !== 'string' || !['public', 'private'].includes(data.visibility)) { setError('Could not load sharing. Close and reopen to retry.'); return; }
      const value = data as Sharing; setInitial(value); setUsers(value.users); setGroups(value.selected_groups); setVisibility(value.visibility);
    }).catch(() => { if (active) setError('Could not load sharing. Close and reopen to retry.'); }); return () => { active = false; };
  }, [kind, item.id]);
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const { error } = await authenticatedRequest(() => supabase.rpc('media_sharing_rpc', { p_type: kind, p_id: item.id, p_action: 'save', p_data: { users: users.map(p => p.id), groups, visibility, revision: initial?.revision } }));
      if (error) throw new Error(error.code === 'P0001' || error.code === '42501' ? error.message : 'Could not save sharing. Please try again.');
      onSaved();
    } finally { pending.current = false; setBusy(false); }
  };
  const submit = () => {
    if (!initial || pending.current) return;
    const removed = [...initial.users.filter(p => !users.some(u => u.id === p.id)).map(p => p.name), ...initial.groups.filter(g => initial.selected_groups.includes(g.id) && !groups.includes(g.id)).map(g => `group "${g.name}"`), ...(initial.visibility === 'public' && visibility === 'private' ? ['public access'] : [])];
    if (removed.length) void requestDelete({ title: 'Remove shared access', message: `Remove access to "${item.file_name}" for ${removed.join(', ')}?`, details: 'Other grants still apply. The original media stays in your library. Temporary links remain separate. Other sharing changes will also be saved.', confirmLabel: 'Save sharing', onConfirm: save });
    else void save().catch(cause => setError(cause instanceof Error ? cause.message : 'Could not save sharing.'));
  };
  return <TaskModal aria-label="Share content" className="chat-modal"><section className="chat-dialog"><header><h2>Share {kind}</h2></header><div className="chat-dialog-body">
    <p>Share “{item.file_name}” with people or Messenger groups. Group membership controls access; the original remains yours.</p>
    {!initial && !error && <p role="status">Loading sharing…</p>}
    {initial && <><label>Visibility<select disabled={busy} value={visibility} onChange={e => setVisibility(e.target.value as 'public' | 'private')}><option value="private">Private — owner and shared recipients</option><option value="public">Public — everyone</option></select></label>
      <h3>People</h3><MessengerPeople disabled={busy} excluded={users.map(p => p.id)} onSelect={p => setUsers(current => [...current, p])} />
      {users.map(p => <label className="chat-check" key={p.id}><input type="checkbox" checked disabled={busy} onChange={() => setUsers(current => current.filter(u => u.id !== p.id))} />{p.name}</label>)}
      <h3>Groups</h3>{!initial.groups.length && <p>No Messenger groups available. Create or join a group in Messages first.</p>}
      {initial.groups.map(g => <label className="chat-check" key={g.id}><input type="checkbox" disabled={busy} checked={groups.includes(g.id)} onChange={e => setGroups(current => e.target.checked ? [...current, g.id] : current.filter(id => id !== g.id))} />{g.name}</label>)}
      <p className="chat-help">New members gain access. Removed members lose group access. Deleting a group never deletes this media. For expiring links, use Create 24-hour share link.</p></>}
    {error && <p role="alert" className="chat-error">{error}</p>}
  </div><footer><button disabled={busy} onClick={close}>Cancel</button><button className="chat-primary" disabled={!initial || busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button></footer></section></TaskModal>;
}
