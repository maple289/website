import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Eye, Search, UserPlus, X } from 'lucide-react';
import { TaskModal } from '@/components/TaskModal';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import { useGuardedClose } from '@/hooks/useGuardedClose';
import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { chatRequest, chatError, chatSize, attachmentEntry, type ChatUser, type Conversation, type ChatMessage, type ChatAttachment } from '@/lib/messenger';
import { filePreviewKind } from '@/lib/filePreviews';
import { useAuth } from '@/hooks/useAuth';

export function ChatDialog({ title, close, children, busy = false }: { title: string; close: () => void; children: ReactNode; busy?: boolean }) {
  return <TaskModal aria-label={title} className="chat-modal"><section className="chat-dialog"><header><h2>{title}</h2><button type="button" aria-label="Close" disabled={busy} onClick={close}><X size={20} /></button></header>{children}</section></TaskModal>;
}
function UserSearch({ onSelect, excluded = [] }: { onSelect: (user: ChatUser) => void; excluded?: string[] }) {
  const [query, setQuery] = useState(''), [users, setUsers] = useState<ChatUser[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setUsers([]); setError(''); setLoading(false);
    if (query.trim().length < 2) return;
    setLoading(true);
    const timer = window.setTimeout(() => { void chatRequest<ChatUser[]>('users', null, { query }).then(rows => { if (active) setUsers(rows); }).catch(cause => { if (active) setError(chatError(cause)); }).finally(() => { if (active) setLoading(false); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  return <div className="chat-user-search"><label>Find registered users<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or email (at least 2 characters)" maxLength={100} /></label>
    {loading && <p role="status">Searching…</p>}{error && <p className="chat-error" role="alert">{error}</p>}
    {users.filter(item => !excluded.includes(item.id)).map(item => <button type="button" key={item.id} onClick={() => onSelect(item)}><span className="chat-avatar">{item.name[0]?.toUpperCase()}</span><span>{item.name}</span><UserPlus size={17} /></button>)}
    {!loading && query.trim().length >= 2 && !users.length && !error && <p>No matching users.</p>}
  </div>;
}
export function NewConversation({ close, created }: { close: () => void; created: (id: string) => void }) {
  const [group, setGroup] = useState(false), [name, setName] = useState(''), [selected, setSelected] = useState<ChatUser[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), guarded = useGuardedClose(close, group || !!name || !!selected.length, busy);
  const submit = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { const result = await chatRequest<{ id: string }>('create', null, { kind: group ? 'group' : 'direct', text: name, members: selected.map(item => item.id) }); created(result.id); }
    catch (cause) { setError(chatError(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <ChatDialog title={group ? 'Create group' : 'New conversation'} close={guarded} busy={busy}><div className="chat-dialog-body"><label className="chat-check"><input type="checkbox" checked={group} disabled={busy} onChange={event => { setGroup(event.target.checked); setSelected([]); }} />Group conversation</label>
    {group && <label>Group name<input value={name} disabled={busy} maxLength={100} onChange={event => setName(event.target.value)} /></label>}
    <div className="chat-selected-users">{selected.map(item => <button disabled={busy} type="button" key={item.id} onClick={() => setSelected(current => current.filter(user => user.id !== item.id))}>{item.name}<X size={14} /></button>)}</div>
    {!busy && <UserSearch excluded={selected.map(item => item.id)} onSelect={item => setSelected(current => group ? [...current, item].slice(0, 49) : [item])} />}
    <p className="chat-help">Only conversation members can read messages and attachments. Groups support up to 50 members.</p>{error && <p className="chat-error" role="alert">{error}</p>}</div>
    <footer><button disabled={busy} onClick={guarded}>Cancel</button><button className="chat-primary" disabled={busy || !selected.length || (group && !name.trim())} onClick={() => void submit()}>{busy ? 'Creating…' : group ? 'Create group' : 'Open conversation'}</button></footer></ChatDialog>;
}
export function EditMessage({ message, close, saved }: { message: ChatMessage; close: () => void; saved: () => void }) {
  const [text, setText] = useState(message.body), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const guard = useGuardedClose(close, text !== message.body, busy), pending = useRef(false);
  const save = async () => { if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try { await chatRequest('edit', message.conversation_id, { id: message.id, text }); saved(); close(); } catch (cause) { setError(chatError(cause)); } finally { pending.current = false; setBusy(false); } };
  return <ChatDialog title="Edit message" close={guard} busy={busy}><div className="chat-dialog-body"><label>Message<textarea value={text} disabled={busy} maxLength={10000} rows={5} onChange={event => setText(event.target.value)} /></label>{error && <p className="chat-error" role="alert">{error}</p>}</div><footer><button disabled={busy} onClick={guard}>Cancel</button><button disabled={busy || (!text.trim() && !message.attachments.length)} className="chat-primary" onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></footer></ChatDialog>;
}
export function GroupInformation({ conversation, close, changed }: { conversation: Conversation; close: () => void; changed: () => Promise<void> }) {
  const { user } = useAuth(), { requestDelete } = useDeleteConfirmation();
  const [name, setName] = useState(conversation.name), [original, setOriginal] = useState(conversation.name), [members, setMembers] = useState(conversation.members), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), guard = useGuardedClose(close, name !== original, busy);
  const manages = conversation.role !== 'member';
  const reload = async () => { const updated = await chatRequest<Conversation>('conversation', conversation.id); setMembers(updated.members); await changed(); };
  const run = async (action: string, data: Record<string, unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await chatRequest(action, conversation.id, data); await reload(); if (action === 'group-name') { setName(name.trim()); setOriginal(name.trim()); } }
    catch (cause) { setError(chatError(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const remove = (target: ChatUser) => { void requestDelete({ title: 'Remove group member', message: `Remove "${target.name}" from "${conversation.name}"?`, details: 'This revokes access to this conversation and its attachments. Messages already sent remain in the group.', confirmLabel: 'Remove Member', onConfirm: async () => { await chatRequest('remove-member', conversation.id, { user_id: target.id }); await reload(); } }); };
  return <ChatDialog title="Group information & members" close={guard} busy={busy}><div className="chat-dialog-body"><label>Group name<input disabled={!manages || busy} maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
    {manages && <button disabled={busy || name === original || !name.trim()} className="chat-primary" onClick={() => void run('group-name', { text: name })}>Save name</button>}
    <p className="chat-help">New members can read the existing conversation history. Leaving or removal revokes future access. If the owner leaves, ownership passes to the oldest administrator or member.</p>
    <div className="chat-members">{members.map(item => <div key={item.id}><span className="chat-avatar">{item.name[0]?.toUpperCase()}</span><span><strong>{item.name}{item.id === user?.id ? ' (you)' : ''}</strong><small>{item.role} · {item.online ? 'Online' : 'Offline'}</small></span>
      {conversation.role === 'owner' && item.role !== 'owner' && <select aria-label={`Role for ${item.name}`} disabled={busy} value={item.role} onChange={event => void run('member-role', { user_id: item.id, role: event.target.value })}><option value="member">Member</option><option value="admin">Admin</option></select>}
      {manages && item.id !== user?.id && item.role !== 'owner' && (item.role !== 'admin' || conversation.role === 'owner') && <button disabled={busy} className="chat-danger" onClick={() => remove(item)}>Remove</button>}
    </div>)}</div>
    {manages && !busy && <UserSearch excluded={members.map(item => item.id)} onSelect={item => void run('add-member', { user_id: item.id })} />}
    {error && <p role="alert" className="chat-error">{error}</p>}</div><footer><button disabled={busy} onClick={guard}>Close</button></footer></ChatDialog>;
}
export function ConversationSearch({ conversation, revision, close, reply }: { conversation: Conversation; revision: number; close: () => void; reply: (message: ChatMessage) => void }) {
  const [query, setQuery] = useState(''), [results, setResults] = useState<ChatMessage[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false), [more, setMore] = useState(false);
  const generation = useRef(0);
  useEffect(() => { let active = true; generation.current++; setResults([]); setMore(false); setError(''); setLoading(false); if (query.trim().length < 2) return;
    setLoading(true); const timer = window.setTimeout(() => { void chatRequest<ChatMessage[]>('search', conversation.id, { query }).then(rows => { if (active) { setResults(rows); setMore(rows.length === 50); } }).catch(cause => { if (active) setError(chatError(cause)); }).finally(() => { if (active) setLoading(false); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, conversation.id, revision]);
  const loadMore = async () => { if (loading) return; const currentGeneration = generation.current; setLoading(true); try { const rows = await chatRequest<ChatMessage[]>('search', conversation.id, { query, offset: results.length }); if (generation.current !== currentGeneration) return; setResults(current => [...new Map([...current, ...rows].map(item => [item.id, item])).values()]); setMore(rows.length === 50); } catch (cause) { if (generation.current === currentGeneration) setError(chatError(cause)); } finally { if (generation.current === currentGeneration) setLoading(false); } };
  return <ChatDialog title={`Search · ${conversation.name}`} close={close}><div className="chat-dialog-body"><label><Search size={16} />Search messages<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Words in this conversation" maxLength={100} /></label>
    {results.map(item => <button className="chat-search-result" key={item.id} onClick={() => { reply(item); close(); }}><strong>{item.sender_name}</strong><time>{new Date(item.created_at).toLocaleString()}</time><span>{item.body}</span><small>Click to reply to this message</small></button>)}
    {loading && <p role="status">Searching…</p>}{!loading && query.trim().length >= 2 && !results.length && !error && <p>No matching messages.</p>}{more && <button disabled={loading} onClick={() => void loadMore()}>More results</button>}{error && <p className="chat-error" role="alert">{error}</p>}</div><footer><button onClick={close}>Close</button></footer></ChatDialog>;
}
export function SharedChatFiles({ conversation, revision, close, preview, download }: { conversation: Conversation; revision: number; close: () => void; preview: (attachment: ChatAttachment) => void; download: (attachment: ChatAttachment) => void }) {
  const [files, setFiles] = useState<ChatAttachment[]>([]), [loading, setLoading] = useState(false), [more, setMore] = useState(true), [error, setError] = useState('');
  const generation = useRef(0);
  const load = async (offset: number) => { const currentGeneration = generation.current; setLoading(true); try { const rows = await chatRequest<ChatAttachment[]>('files', conversation.id, { offset }); if (generation.current !== currentGeneration) return; setFiles(current => offset ? [...new Map([...current, ...rows].map(item => [item.id, item])).values()] : rows); setMore(rows.length === 50); } catch (cause) { if (generation.current === currentGeneration) setError(chatError(cause)); } finally { if (generation.current === currentGeneration) setLoading(false); } };
  useEffect(() => { generation.current++; setFiles([]); setError(''); void load(0); return () => { generation.current++; }; }, [conversation.id, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ChatDialog title="Shared media & files" close={close}><div className="chat-dialog-body">{files.map(item => <div className="chat-attachment" key={item.id}><FileTypeIcon entry={attachmentEntry(item)} size={28} /><span><strong>{item.name}</strong><small>{chatSize(item.file_size)}</small></span>{filePreviewKind(attachmentEntry(item)) && <button aria-label={`Preview ${item.name}`} onClick={() => preview(item)}><Eye size={18} /></button>}<button aria-label={`Download ${item.name}`} onClick={() => download(item)}><Download size={18} /></button></div>)}
    {loading && <p role="status">Loading files…</p>}{!loading && !files.length && !error && <p>No shared files yet.</p>}{more && !loading && <button onClick={() => void load(files.length)}>Load more</button>}{error && <p className="chat-error" role="alert">{error}</p>}</div><footer><button onClick={close}>Close</button></footer></ChatDialog>;
}
export function BlockedUsers({ close, changed }: { close: () => void; changed: () => Promise<void> }) {
  const [users, setUsers] = useState<ChatUser[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), pending = useRef(false);
  const load = () => chatRequest<ChatUser[]>('blocked-users').then(setUsers).catch(cause => setError(chatError(cause)));
  useEffect(() => { void load(); }, []);
  const unblock = async (id: string) => { if (pending.current) return; pending.current = true; setBusy(true); try { await chatRequest('unblock', null, { user_id: id }); await load(); await changed(); } catch (cause) { setError(chatError(cause)); } finally { pending.current = false; setBusy(false); } };
  return <ChatDialog title="Blocked users" close={close} busy={busy}><div className="chat-dialog-body">{users.map(item => <div className="chat-members" key={item.id}><div><strong>{item.name}</strong><button disabled={busy} onClick={() => void unblock(item.id)}>Unblock</button></div></div>)}{!users.length && <p>No blocked users.</p>}{error && <p className="chat-error" role="alert">{error}</p>}</div><footer><button disabled={busy} onClick={close}>Close</button></footer></ChatDialog>;
}
