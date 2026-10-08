import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BellOff, Check, CheckCheck, Download, Eye, FileSearch, LoaderCircle, MessageCircle, Paperclip, Pencil, Plus, Reply, Search, Send, ShieldOff, Smile, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMessenger } from '@/context/MessengerContext';
import { ContentContextMenu, type ContentAction } from '@/components/ContentContextMenu';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { filePreviewKind } from '@/lib/filePreviews';
import { attachmentEntry, ChatRequestError, chatError, chatOperation, chatPreview, chatReactions, chatRequest, chatRequestId, chatSize, chatVideo, downloadChatAttachment, openConversation, uploadChatAttachment, type ChatAttachment, type ChatMessage, type Conversation, type PendingAttachment } from '@/lib/messenger';
import { BlockedUsers, ChatDialog, ConversationSearch, EditMessage, GroupInformation, NewConversation, SharedChatFiles } from './MessengerDialogs';
import './Messenger.css';

const FilePreview = lazy(() => import('./FilePreview').then(module => ({ default: module.FilePreview })));
type Draft = { text: string; reply: ChatMessage | null; attachments: PendingAttachment[]; nonce: string; uncertain: boolean };
const newDraft = (): Draft => ({ text: '', reply: null, attachments: [], nonce: chatRequestId(), uncertain: false });
const currentConversation = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('conversation') ?? '';

export function Messenger() {
  const { user } = useAuth(), { conversations, connection, error, revision, refresh } = useMessenger();
  const [selected, setSelected] = useState(currentConversation), [query, setQuery] = useState(''), [list, setList] = useState<Conversation[]>(conversations), [more, setMore] = useState(conversations.length === 50), [listLoading, setListLoading] = useState(false), [listError, setListError] = useState('');
  const [newChat, setNewChat] = useState(false), [blocked, setBlocked] = useState(false);
  const drafts = useRef(new Map<string, Draft>());
  useEffect(() => { const change = () => setSelected(currentConversation()); window.addEventListener('hashchange', change); window.addEventListener('popstate', change); return () => { window.removeEventListener('hashchange', change); window.removeEventListener('popstate', change); }; }, []);
  useEffect(() => { let active = true; setListError('');
    if (!query.trim()) { setListLoading(false); setList(conversations); setMore(conversations.length === 50); return; }
    setListLoading(true);
    const timer = window.setTimeout(() => { void chatRequest<{ conversations: Conversation[] }>('inbox', null, { query }).then(data => { if (active) { setList(data.conversations); setMore(data.conversations.length === 50); } }).catch(cause => { if (active) setListError(chatError(cause)); }).finally(() => { if (active) setListLoading(false); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, conversations]);
  const loadMore = async () => { if (listLoading) return; setListLoading(true); try { const data = await chatRequest<{ conversations: Conversation[] }>('inbox', null, { query, offset: list.length }); setList(current => [...new Map([...current, ...data.conversations].map(item => [item.id, item])).values()]); setMore(data.conversations.length === 50); } catch (cause) { setListError(chatError(cause)); } finally { setListLoading(false); } };
  if (!user) return null;
  return <section className={`messenger ${selected ? 'chat-has-selection' : ''}`} aria-label="Messages"><header className="chat-page-header"><div><h1>Messages</h1><p>Private conversations · <span role="status">{connection}</span></p></div><button className="chat-primary" onClick={() => setNewChat(true)}><Plus size={18} /><span>New message</span></button><ContentContextMenu name="Messages" actions={[{ id: 'blocked', label: 'Blocked users', icon: <ShieldOff size={17} />, run: () => setBlocked(true) }]} /></header>
    {error && <p className="chat-error chat-service-error" role="alert">{error} <button onClick={() => void refresh()}>Retry</button></p>}
    <div className="chat-workspace"><aside className="chat-conversation-list" aria-label="Conversations"><label className="chat-search"><Search size={17} /><input aria-label="Search conversations" placeholder="Search conversations" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label><div className="chat-inbox-items">
      {list.map(item => <button key={item.id} className={`chat-inbox-item ${selected === item.id ? 'is-active' : ''}`} aria-current={selected === item.id ? 'page' : undefined} onClick={() => openConversation(item.id)}><span className="chat-avatar">{item.kind === 'group' ? <Users size={19} /> : item.name[0]?.toUpperCase()}<i data-online={item.members.some(member => member.id !== user.id && member.online)} /></span><span className="chat-inbox-text"><strong>{item.name}{item.muted && <BellOff size={13} />}</strong><span>{item.latest?.body || (item.latest?.attachments.length ? 'Sent an attachment' : 'No messages yet')}</span></span>{item.unread > 0 && <span className="chat-count">{item.unread > 99 ? '99+' : item.unread}</span>}</button>)}
      {!list.length && !listLoading && <p className="chat-empty">{query ? 'No matching conversations.' : 'Start a conversation with a registered user.'}</p>}
      {listLoading && <p role="status" className="chat-empty">Loading…</p>}{more && !listLoading && <button className="chat-load-more" onClick={() => void loadMore()}>More conversations</button>}{listError && <p className="chat-error" role="alert">{listError}</p>}
    </div></aside>
      {selected ? <ConversationPane key={selected} id={selected} revision={revision} drafts={drafts.current} /> : <div className="chat-welcome"><MessageCircle size={48} /><h2>Your conversations</h2><p>Select a conversation or start a new message.</p><button className="chat-primary" onClick={() => setNewChat(true)}>New conversation</button></div>}
    </div>
    {newChat && <NewConversation close={() => setNewChat(false)} created={id => { setNewChat(false); openConversation(id); void refresh(); }} />}
    {blocked && <BlockedUsers close={() => setBlocked(false)} changed={refresh} />}
  </section>;
}

function ConversationPane({ id, revision, drafts }: { id: string; revision: number; drafts: Map<string, Draft> }) {
  const { user } = useAuth(), { refresh, typing, setTyping } = useMessenger(), { requestDelete } = useDeleteConfirmation();
  const [conversation, setConversation] = useState<Conversation | null>(null), [messages, setMessages] = useState<ChatMessage[]>([]), [error, setError] = useState(''), [initial, setInitial] = useState(true), [hasOlder, setHasOlder] = useState(true), [olderBusy, setOlderBusy] = useState(false), [away, setAway] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => drafts.get(id) ?? newDraft()), [sending, setSending] = useState(false), [preview, setPreview] = useState<ChatAttachment | null>(null), [edit, setEdit] = useState<ChatMessage | null>(null), [dialog, setDialog] = useState<'info' | 'search' | 'files' | null>(null);
  const viewport = useRef<HTMLDivElement>(null), filePicker = useRef<HTMLInputElement>(null), input = useRef<HTMLTextAreaElement>(null), loaded = useRef<ChatMessage[]>([]), alive = useRef(true), fetching = useRef(false), refreshAgain = useRef(false), atBottom = useRef(true), readSequence = useRef(0), pending = useRef(false), uploads = useRef(new Map<string, AbortController>()), downloadPending = useRef(new Set<string>());
  const draftRef = useRef(draft);
  const updateDraft = (update: (current: Draft) => Draft) => { const next = update(draftRef.current); draftRef.current = next; drafts.set(id, next); setDraft(next); };
  const replaceMessages = (rows: ChatMessage[]) => { loaded.current = rows; setMessages(rows); };
  const sync = useCallback(async () => {
    if (fetching.current) { refreshAgain.current = true; return; }
    fetching.current = true;
    const bottom = atBottom.current;
    try {
      const previous = loaded.current;
      const [info, snapshot, latest] = await Promise.all([
        chatRequest<Conversation>('conversation', id),
        previous.length ? chatRequest<ChatMessage[]>('snapshot', id, { ids: previous.map(item => item.id) }) : Promise.resolve([] as ChatMessage[]),
        bottom || !previous.length ? chatRequest<ChatMessage[]>('messages', id) : Promise.resolve([] as ChatMessage[]),
      ]);
      let added: ChatMessage[] = [], sequence = previous[previous.length - 1]?.sequence ?? 0;
      const resetWindow = bottom && previous.length > 0 && info.last_sequence - sequence > 500;
      // Fill any reconnect gap rather than assuming the latest 50 contain every
      // missed message. A bounded 500-message window limits browser memory.
      if (bottom && previous.length && !resetWindow && info.last_sequence > sequence) {
        for (let page = 0; page < 3; page++) {
          const rows = await chatRequest<ChatMessage[]>('since', id, { sequence }); added = [...added, ...rows];
          if (rows.length < 200) break;
          sequence = rows[rows.length - 1].sequence;
        }
      }
      if (!alive.current) return;
      const combined = [...new Map([...(resetWindow ? [] : snapshot), ...added, ...latest].map(item => [item.id, item])).values()].sort((a, b) => a.sequence - b.sequence);
      const rows = bottom ? combined.slice(-500) : combined.slice(0, 500);
      setConversation(info); replaceMessages(rows); setError(''); setInitial(false);
      if (!previous.length || resetWindow) setHasOlder(latest.length === 50);
      if (bottom) requestAnimationFrame(() => { viewport.current?.scrollTo({ top: viewport.current.scrollHeight }); markRead(); });
    } catch (cause) { if (alive.current) { setError(chatError(cause)); setInitial(false); if (cause instanceof ChatRequestError && cause.code === '42501') { setConversation(null); replaceMessages([]); setPreview(null); setDialog(null); setEdit(null); } } }
    finally { fetching.current = false; if (refreshAgain.current && alive.current) { refreshAgain.current = false; void sync(); } }
    // Mutable refs deliberately preserve the loaded window and scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { alive.current = true; const transfers = uploads.current; void sync(); return () => {
    alive.current = false;
    const cancelled = { ...draftRef.current, attachments: draftRef.current.attachments.map(item => item.state === 'uploading' ? { ...item, state: 'failed' as const, error: 'Upload cancelled. Select this file again to upload it.' } : item) };
    draftRef.current = cancelled; drafts.set(id, cancelled);
    for (const controller of transfers.values()) controller.abort(); setTyping(id, false);
  }; }, [id, sync, setTyping, drafts]);
  useEffect(() => { void sync(); }, [revision, sync]);
  const markRead = () => {
    const sequence = loaded.current[loaded.current.length - 1]?.sequence ?? 0;
    if (!document.hasFocus() || document.hidden || !atBottom.current || sequence <= readSequence.current || !alive.current) return;
    readSequence.current = sequence;
    void chatRequest('read', id, { sequence }).then(() => refresh()).catch(() => { readSequence.current = 0; });
  };
  useEffect(() => { window.addEventListener('focus', markRead); document.addEventListener('visibilitychange', markRead); return () => { window.removeEventListener('focus', markRead); document.removeEventListener('visibilitychange', markRead); }; }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadOlder = async () => {
    if (olderBusy || !hasOlder || !loaded.current.length || fetching.current) return;
    fetching.current = true; setOlderBusy(true); atBottom.current = false; setAway(true);
    const anchorId = loaded.current[0].id;
    const anchorTop = viewport.current?.querySelector(`[data-message-id="${anchorId}"]`)?.getBoundingClientRect().top ?? 0;
    try {
      const rows = await chatRequest<ChatMessage[]>('messages', id, { before: loaded.current[0].sequence });
      if (!alive.current) return;
      replaceMessages([...new Map([...rows, ...loaded.current].map(item => [item.id, item])).values()].sort((a, b) => a.sequence - b.sequence).slice(0, 500));
      setHasOlder(rows.length === 50);
      requestAnimationFrame(() => { const anchor = viewport.current?.querySelector(`[data-message-id="${anchorId}"]`); if (viewport.current && anchor) viewport.current.scrollTop += anchor.getBoundingClientRect().top - anchorTop; });
    } catch (cause) { if (alive.current) setError(chatError(cause)); } finally { fetching.current = false; if (alive.current) { setOlderBusy(false); if (refreshAgain.current) { refreshAgain.current = false; void sync(); } } }
  };
  const changed = async () => { await sync(); await refresh(); };
  const download = async (attachment: ChatAttachment) => {
    if (downloadPending.current.has(attachment.id)) return;
    downloadPending.current.add(attachment.id);
    try { await downloadChatAttachment(attachment); } catch (cause) { setError(chatError(cause)); } finally { downloadPending.current.delete(attachment.id); }
  };
  const addFiles = async (files: File[]) => {
    if (pending.current || draftRef.current.uncertain) return;
    if (draftRef.current.attachments.length + files.length > 10) { setError('A message can contain up to 10 attachments.'); return; }
    if (draftRef.current.attachments.reduce((total, item) => total + item.file_size, 0) + files.reduce((total, file) => total + file.size, 0) > 200 * 1048576) { setError('Attachments exceed the 200 MB message limit.'); return; }
    // Two transfer lanes keep batch uploads responsive without flooding the VM.
    const jobs = files.map(file => ({ file, id: chatRequestId() }));
    updateDraft(current => ({ ...current, attachments: [...current.attachments, ...jobs.map(job => ({ id: job.id, name: job.file.name, mime_type: job.file.type, file_size: job.file.size, state: 'uploading' as const, progress: 0 }))] }));
    const lane = async () => {
      let job;
      while (alive.current && (job = jobs.shift())) {
        const temporaryId = job.id, controller = new AbortController(); uploads.current.set(temporaryId, controller);
        try {
          const result = await uploadChatAttachment(id, job.file, controller.signal, value => { if (alive.current) updateDraft(current => ({ ...current, attachments: current.attachments.map(item => item.id === temporaryId ? { ...item, progress: value } : item) })); });
          if (alive.current) updateDraft(current => ({ ...current, attachments: current.attachments.map(item => item.id === temporaryId ? { ...result, state: 'ready', progress: 100 } : item) }));
          else await chatRequest('cancel-attachment', id, { id: result.id }).catch(() => undefined);
        } catch (cause) { const current = alive.current ? draftRef.current : drafts.get(id) ?? draftRef.current; const next = { ...current, attachments: current.attachments.map(item => item.id === temporaryId ? { ...item, state: 'failed' as const, error: chatError(cause) } : item) }; draftRef.current = next; drafts.set(id, next); if (alive.current) setDraft(next); }
        finally { uploads.current.delete(temporaryId); }
      }
    };
    await Promise.all([lane(), lane()]);
  };
  const removeDraftAttachment = async (attachment: PendingAttachment) => {
    if (pending.current || draftRef.current.uncertain) return;
    uploads.current.get(attachment.id)?.abort();
    try { if (attachment.state === 'ready') await chatRequest('cancel-attachment', id, { id: attachment.id }); updateDraft(current => ({ ...current, attachments: current.attachments.filter(item => item.id !== attachment.id) })); } catch (cause) { setError(chatError(cause)); }
  };
  const send = async () => {
    if (pending.current || draftRef.current.attachments.some(item => item.state === 'uploading') || (!draftRef.current.text.trim() && !draftRef.current.attachments.some(item => item.state === 'ready'))) return;
    pending.current = true; setSending(true); setError(''); setTyping(id, false);
    const outgoing = draftRef.current;
    try {
      await chatRequest<ChatMessage>('send', id, { client_id: outgoing.nonce, text: outgoing.text, reply_to: outgoing.reply?.id ?? null, attachments: outgoing.attachments.filter(item => item.state === 'ready').map(item => item.id) });
      updateDraft(() => newDraft()); atBottom.current = true; setAway(false); loaded.current = []; void changed().catch(cause => { if (alive.current) setError(chatError(cause)); }); input.current?.focus();
    } catch (cause) {
      // Retrying uses the identical nonce and payload. Lock edits until that
      // retry resolves; a lost response must never duplicate a delivered message.
      const uncertain = !(cause instanceof ChatRequestError) || cause.uncertain;
      updateDraft(current => ({ ...current, uncertain })); setError(`${chatError(cause)}${uncertain ? ' Use Retry Send to resolve this message without sending it twice.' : ''}`);
    } finally { pending.current = false; setSending(false); }
  };
  const deleteMessage = (message: ChatMessage) => { void requestDelete({ title: 'Delete message', message: `Permanently delete your message "${message.body.slice(0, 80) || message.attachments[0]?.name || 'Attachment'}"?`, details: 'This removes the message, its reactions and attached files for all conversation members. Replies remain, without the deleted quote.', onConfirm: async () => { await chatOperation('delete', { conversation_id: id, id: message.id }); replaceMessages(loaded.current.filter(item => item.id !== message.id)); await changed(); } }); };
  const discardPending = () => { void requestDelete({ title: 'Discard pending draft?', message: 'Discard this message draft and its unsent attachments?', details: 'If this message was already delivered, it stays in the conversation. A late retry of this draft will be cancelled.', confirmLabel: 'Discard Draft', onConfirm: async () => { const outgoing = draftRef.current; await chatRequest('cancel-send', id, { client_id: outgoing.nonce, attachments: outgoing.attachments.filter(item => item.state === 'ready').map(item => item.id) }); updateDraft(() => newDraft()); await changed(); } }); };
  const leave = () => { if (!conversation) return; void requestDelete({ title: 'Leave group', message: `Leave "${conversation.name}"?`, details: `You will lose access to the conversation and its attachments. Your messages remain.${conversation.role === 'owner' ? ' Ownership will pass to the oldest administrator or member.' : ''}`, confirmLabel: 'Leave Group', onConfirm: async () => { await chatRequest('leave', id); drafts.delete(id); openConversation(); await refresh(); } }); };
  const toggleBlock = () => { const other = conversation?.members.find(item => item.id !== user?.id); if (!other) return;
    if (other.blocked) { void chatRequest('unblock', null, { user_id: other.id }).then(changed).catch(cause => setError(chatError(cause))); return; }
    void requestDelete({ title: 'Block user', message: `Block "${other.name}"?`, details: 'Direct messaging will be disabled in both directions. Existing messages remain, and shared group conversations are unaffected.', confirmLabel: 'Block User', onConfirm: async () => { await chatRequest('block', null, { user_id: other.id }); await changed(); } }); };
  const actions: ContentAction[] = conversation ? [
    { id: 'info', label: conversation.kind === 'group' ? 'Group information & members' : 'View profile', icon: <Users size={17} />, run: () => setDialog('info') },
    { id: 'search', label: 'Search conversation', icon: <Search size={17} />, run: () => setDialog('search') },
    { id: 'files', label: 'Shared media & files', icon: <FileSearch size={17} />, run: () => setDialog('files') },
    { id: 'mute', label: conversation.muted ? 'Unmute notifications' : 'Mute notifications', icon: <BellOff size={17} />, run: () => { void chatRequest('mute', id, { muted: !conversation.muted }).then(changed).catch(cause => setError(chatError(cause))); } },
    ...(conversation.kind === 'group' ? [{ id: 'leave', label: 'Leave group', danger: true, run: leave }] : [{ id: 'block', label: conversation.members.some(item => item.id !== user?.id && item.blocked) ? 'Unblock user' : 'Block user', icon: <ShieldOff size={17} />, run: toggleBlock }]),
  ] : [];
  const typingNames = conversation?.members.filter(member => member.id !== user?.id && typing.some(item => item.conversation_id === id && item.user_id === member.id)).map(item => item.name) ?? [];
  const other = conversation?.members.find(item => item.id !== user?.id);
  const entry = useMemo(() => preview ? attachmentEntry(preview) : null, [preview]);
  return <div className="chat-pane"><header className="chat-thread-header"><button className="chat-mobile-back" aria-label="Back to conversations" onClick={() => openConversation()}><ArrowLeft size={20} /></button><span className="chat-avatar">{conversation?.kind === 'group' ? <Users size={19} /> : conversation?.name[0]?.toUpperCase() || <MessageCircle size={19} />}</span><div><h2>{conversation?.name || 'Conversation'}</h2><p>{conversation?.kind === 'group' ? `${conversation.members.length} members` : other?.online ? 'Online' : other?.last_seen ? `Last seen ${new Date(other.last_seen).toLocaleString()}` : 'Offline'}</p></div>{conversation && <ContentContextMenu name={conversation.name} actions={actions} />}</header>
    {error && <p className="chat-error" role="alert">{error}<button onClick={() => void sync()}>Refresh conversation</button></p>}
    {away && <button className="chat-load-more" onClick={() => { if (fetching.current) return; atBottom.current = true; setAway(false); loaded.current = []; void sync(); }}>Go to latest messages{conversation && conversation.last_sequence > (messages[messages.length - 1]?.sequence ?? 0) ? ' · New messages' : ''}</button>}
    <div className="chat-message-list" ref={viewport} onScroll={() => { const node = viewport.current; if (!node) return; atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80 && (loaded.current[loaded.current.length - 1]?.sequence ?? 0) >= (conversation?.latest?.sequence ?? 0); setAway(!atBottom.current); markRead(); if (!atBottom.current && node.scrollTop < 30) void loadOlder(); }}>
      {initial ? <p role="status" className="chat-empty"><LoaderCircle size={22} className="animate-spin" />Loading messages…</p> : <>
        {hasOlder && messages.length > 0 && <button className="chat-load-more" disabled={olderBusy} onClick={() => void loadOlder()}>{olderBusy ? 'Loading…' : 'Load older messages'}</button>}
        {!messages.length && conversation && <p className="chat-empty">No messages yet. Say hello.</p>}
        {messages.map(message => <MessageItem key={message.id} message={message} conversation={conversation} own={message.sender_id === user?.id} reply={() => { if (!draftRef.current.uncertain) { updateDraft(current => ({ ...current, reply: message })); input.current?.focus(); } }} edit={() => setEdit(message)} remove={() => deleteMessage(message)} preview={setPreview} download={attachment => void download(attachment)} changed={changed} />)}
      </>}
    </div>
    <div className="chat-typing" role="status">{typingNames.length ? `${typingNames.slice(0, 3).join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…` : ''}</div>
    {conversation && <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      {!conversation.can_send && <p className="chat-help">Messaging is unavailable. A member may be blocked or inactive.</p>}
      {draft.uncertain && <button type="button" disabled={sending} className="chat-danger chat-load-more" onClick={discardPending}>Discard pending draft</button>}
      {draft.reply && <div className="chat-reply-draft"><span><strong>Reply to {draft.reply.sender_name}</strong><span>{draft.reply.body.slice(0, 120) || 'Attachment'}</span></span><button type="button" disabled={sending || draft.uncertain} aria-label="Cancel reply" onClick={() => updateDraft(current => ({ ...current, reply: null }))}><X size={17} /></button></div>}
      {!!draft.attachments.length && <div className="chat-pending-files">{draft.attachments.map(item => <div key={item.id}><FileTypeIcon entry={attachmentEntry(item)} size={21} /><span><strong>{item.name}</strong><small>{item.state === 'uploading' ? `Uploading ${item.progress}%` : item.state === 'ready' ? 'Ready to send' : item.error || 'Upload failed'}</small>{item.state === 'uploading' && <progress value={item.progress} max={100} />}</span><button type="button" disabled={sending || draft.uncertain} aria-label={`Remove unsent attachment ${item.name}`} onClick={() => void removeDraftAttachment(item)}><X size={16} /></button></div>)}</div>}
      <div className="chat-composer-row"><input ref={filePicker} type="file" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files); }} /><button type="button" aria-label="Attach files" title="Attach files (100 MB each)" disabled={!conversation.can_send || sending || draft.uncertain} onClick={() => filePicker.current?.click()}><Paperclip size={21} /></button><textarea ref={input} aria-label="Message" placeholder="Type a message…" rows={1} maxLength={10000} value={draft.text} disabled={!conversation.can_send || sending || draft.uncertain} onChange={event => { updateDraft(current => ({ ...current, text: event.target.value })); setTyping(id, !!event.target.value); }} onBlur={() => setTyping(id, false)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) { event.preventDefault(); void send(); } }} /><button type="submit" className="chat-send" disabled={!conversation.can_send || sending || draft.attachments.some(item => item.state === 'uploading') || (!draft.text.trim() && !draft.attachments.some(item => item.state === 'ready'))} aria-label={draft.uncertain ? 'Retry Send' : 'Send message'} title={draft.uncertain ? 'Retry Send' : 'Send message'}>{sending ? <LoaderCircle size={21} className="animate-spin" /> : <Send size={21} />}{draft.uncertain && <span>Retry Send</span>}</button></div>
    </form>}
    {edit && <EditMessage message={edit} close={() => setEdit(null)} saved={() => void changed()} />}
    {dialog === 'info' && conversation && (conversation.kind === 'group' ? <GroupInformation conversation={conversation} close={() => setDialog(null)} changed={changed} /> : <ChatDialog title="Profile" close={() => setDialog(null)}><div className="chat-dialog-body"><h3>{other?.name || 'Deleted user'}</h3><p>{other?.online ? 'Online' : 'Offline'}</p>{other?.last_seen && <p>Last seen {new Date(other.last_seen).toLocaleString()}</p>}</div><footer><button onClick={() => setDialog(null)}>Close</button></footer></ChatDialog>)}
    {dialog === 'search' && conversation && <ConversationSearch conversation={conversation} close={() => setDialog(null)} reply={message => updateDraft(current => ({ ...current, reply: message }))} />}
    {dialog === 'files' && conversation && <SharedChatFiles conversation={conversation} close={() => setDialog(null)} preview={setPreview} download={attachment => void download(attachment)} />}
    {preview && entry && <Suspense fallback={<p role="status">Loading preview…</p>}><FilePreview entry={entry} onClose={() => setPreview(null)} onDownload={() => void download(preview)} requestPreview={chatPreview} loadVideo={chatVideo} trackViews={false} /></Suspense>}
  </div>;
}

function MessageItem({ message, conversation, own, reply, edit, remove, preview, download, changed }: { message: ChatMessage; conversation: Conversation | null; own: boolean; reply: () => void; edit: () => void; remove: () => void; preview: (attachment: ChatAttachment) => void; download: (attachment: ChatAttachment) => void; changed: () => Promise<void> }) {
  const others = conversation?.members.filter(member => member.id !== message.sender_id && member.joined_sequence < message.sequence) ?? [];
  const read = others.length > 0 && others.every(member => member.read_sequence >= message.sequence), delivered = others.length > 0 && others.every(member => member.delivered_sequence >= message.sequence);
  const actions: ContentAction[] = [{ id: 'reply', label: 'Reply', icon: <Reply size={17} />, disabled: message.deleting, run: reply }, ...(own ? [{ id: 'edit', label: 'Edit message', icon: <Pencil size={17} />, disabled: message.deleting, run: edit }, { id: 'delete', label: message.deleting ? 'Retry deletion' : 'Delete message', icon: <Trash2 size={17} />, danger: true, run: remove }] : [])];
  return <article data-message-id={message.id} className={`chat-message ${own ? 'chat-message-own' : ''}`}><div className="chat-message-bubble"><div className="chat-message-heading"><strong>{own ? 'You' : message.sender_name}</strong><ContentContextMenu name="message" actions={actions} /></div>
    {message.reply && <blockquote><strong>{message.reply.sender_name}</strong><span>{message.reply.body || 'Attachment'}</span></blockquote>}
    {message.body && <p className="chat-body-text">{message.body}</p>}
    {message.attachments.map(attachment => <div className="chat-attachment" key={attachment.id}><FileTypeIcon entry={attachmentEntry(attachment)} size={28} /><span><strong>{attachment.name}</strong><small>{chatSize(attachment.file_size)}{!attachment.available || message.deleting ? ' · Unavailable' : ''}</small></span>{filePreviewKind(attachmentEntry(attachment)) && <button aria-label={`Preview ${attachment.name}`} disabled={!attachment.available || message.deleting} onClick={() => preview(attachment)}><Eye size={18} /></button>}<button aria-label={`Download ${attachment.name}`} disabled={!attachment.available || message.deleting} onClick={() => download(attachment)}><Download size={18} /></button></div>)}
    {message.deleting && <p className="chat-help">Deletion is incomplete. The author can retry deletion.</p>}
    <footer><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{message.edited_at && <span>edited</span>}{own && <span className={read ? 'chat-read' : ''} title={read ? 'Read by all recipients' : delivered ? 'Delivered to all recipients' : 'Sent'} aria-label={read ? 'Read' : delivered ? 'Delivered' : 'Sent'}>{read || delivered ? <CheckCheck size={15} /> : <Check size={15} />}</span>}</footer>
    {!message.deleting && <MessageReactions message={message} changed={changed} />}
  </div></article>;
}
function MessageReactions({ message, changed }: { message: ChatMessage; changed: () => Promise<void> }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [details, setDetails] = useState<string | null>(null), [position, setPosition] = useState({ left: 0, bottom: 0, maxHeight: 300 });
  const button = useRef<HTMLButtonElement>(null), area = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null), pending = useRef(false);
  const mine = message.reactions.find(item => item.user_id === user?.id), choice = chatReactions.find(item => item.id === mine?.reaction);
  useLayoutEffect(() => { if (!open) return; const place = () => { const rect = button.current?.getBoundingClientRect(), visual = window.visualViewport; if (rect) setPosition({ left: Math.max((visual?.offsetLeft ?? 0) + 8, Math.min((visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth) - 66, rect.left)), bottom: Math.max(8, innerHeight - rect.top + 5), maxHeight: Math.max(44, rect.top - (visual?.offsetTop ?? 0) - 12) }); }; place(); menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); window.addEventListener('resize', place); window.addEventListener('scroll', place, true); window.visualViewport?.addEventListener('resize', place); return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); }; }, [open]);
  useEffect(() => { if (!open && !details) return; const close = (event: PointerEvent) => { if (!area.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) { setOpen(false); setDetails(null); } }; const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); setDetails(null); } }; document.addEventListener('pointerdown', close); document.addEventListener('keydown', key); return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); }; }, [open, details]);
  const react = async (reaction: string) => { if (pending.current) return; pending.current = true; setBusy(true); setError(''); setOpen(false); try { await chatRequest('react', message.conversation_id, { id: message.id, reaction }); await changed(); } catch (cause) { setError(chatError(cause)); } finally { pending.current = false; setBusy(false); } };
  return <div className="chat-reactions" ref={area}><button type="button" ref={button} aria-label="Choose reaction" aria-expanded={open} disabled={busy} onClick={() => { setOpen(value => !value); setDetails(null); }}><Smile size={17} /></button>{choice && <button disabled={busy} className="chat-selected-reaction" aria-label={`Remove your ${choice.name} reaction`} title="Click the applied reaction again to remove it" onClick={() => void react(choice.id)}>{choice.emoji}</button>}
    {chatReactions.map(type => { const reactions = message.reactions.filter(item => item.reaction === type.id); return reactions.length ? <span key={type.id} className="chat-reaction-count" onPointerEnter={event => { if (event.pointerType === 'mouse') setDetails(type.id); }} onPointerLeave={event => { if (event.pointerType === 'mouse') setDetails(null); }}><button title={`${type.name}: ${reactions.map(item => item.name).join(', ')}`} aria-expanded={details === type.id} onClick={() => setDetails(current => current === type.id ? null : type.id)}>{type.emoji} {reactions.length}</button>{details === type.id && <span className="chat-reaction-details" role="tooltip"><strong>{type.emoji} {type.name}</strong><span>{reactions.map(item => item.name).join(', ')}</span></span>}</span> : null; })}
    {open && createPortal(<div ref={menu} className="chat-reaction-menu" role="menu" aria-label="Choose a reaction" style={position} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus({ preventScroll: true }); }
      if (event.key === 'Tab') setOpen(false);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []), index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    }}>{chatReactions.map(type => <button role="menuitem" key={type.id} title={type.name} aria-label={type.name} aria-current={mine?.reaction === type.id ? 'true' : undefined} disabled={busy} onClick={() => void react(type.id)}>{type.emoji}</button>)}</div>, document.body)}{error && <span role="alert" className="chat-error">{error}</span>}
  </div>;
}
