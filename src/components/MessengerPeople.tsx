import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMessenger } from '@/context/MessengerContext';
import { chatError, chatRequest, ChatRequestError, type ChatUser } from '@/lib/messenger';

type Person = ChatUser & { online: boolean; conversation_id: string | null; unread: number };
type Cursor = { name: string; id: string };
type Page = { users: Person[]; next: Cursor | null };

// The same account-scoped directory powers desktop People and task pickers.
// Refresh every loaded page so availability changes cannot leave stale entries.
export function MessengerPeople({ onSelect, excluded = [], selectedConversation = '', disabled = false, label = 'Find registered users' }: {
  onSelect: (user: ChatUser) => void; excluded?: string[]; selectedConversation?: string; disabled?: boolean; label?: string;
}) {
  const { user } = useAuth(), { revision } = useMessenger();
  const [query, setQuery] = useState(''), [pages, setPages] = useState(1), [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; users: Person[]; more: boolean; pages: number }>({ key: '', users: [], more: false, pages: 0 });
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const key = `${user?.id ?? ''}:${query}`, previousKey = useRef('');
  const morePending = useRef(false);
  useEffect(() => {
    let active = true;
    const changed = previousKey.current !== key;
    if (changed) morePending.current = false;
    previousKey.current = key;
    setError(''); setLoading(true);
    const timer = window.setTimeout(() => { void (async () => {
      try {
        let next: Cursor | null = null; const users: Person[] = [];
        for (let page = 0; page < pages; page++) {
          const result: Page = await chatRequest('people', null, { query, after: next });
          if (!active) return;
          users.push(...result.users); next = result.next;
          if (!next) break;
        }
        if (active) setSnapshot({ key, users: [...new Map(users.map(person => [person.id, person])).values()], more: !!next, pages });
      } catch (cause) {
        if (active) { setError(chatError(cause)); if (cause instanceof ChatRequestError && cause.code === '42501') setSnapshot({ key, users: [], more: false, pages }); }
      } finally { if (active) { morePending.current = false; setLoading(false); } }
    })(); }, changed && query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, query, pages, revision, retry]);
  const users = snapshot.key === key ? snapshot.users.filter(person => person.id !== user?.id && !excluded.includes(person.id)) : [];
  // Refreshing already loaded pages must not disable a button between pointer
  // down/up. Only an outstanding expansion blocks another pagination action.
  const expanding = snapshot.key === key && pages > snapshot.pages && !error;
  const loadMore = () => {
    if (disabled || morePending.current) return;
    morePending.current = true;
    if (pages > snapshot.pages) setRetry(value => value + 1);
    else setPages(value => value + 1);
  };
  return <div className="chat-people-picker"><label className="chat-search"><Search size={17} /><input aria-label={label} placeholder="Search name or email" value={query} maxLength={100} disabled={disabled} onChange={event => { setQuery(event.target.value); setPages(1); }} /></label>
    <div className="chat-people-items" aria-label="Registered users" aria-busy={loading}>
      {users.map(person => <button type="button" key={person.id} disabled={disabled} className={`chat-inbox-item ${person.conversation_id && selectedConversation === person.conversation_id ? 'is-active' : ''}`} aria-current={person.conversation_id && selectedConversation === person.conversation_id ? 'page' : undefined} onClick={() => onSelect(person)}>
        <span className="chat-avatar">{person.name[0]?.toUpperCase()}<i data-online={person.online} /></span><span className="chat-inbox-text"><strong>{person.name}</strong><span>{person.online ? 'Online' : 'Offline'}</span></span>{person.unread > 0 && <span className="chat-count" aria-label={`${person.unread} unread messages`}>{person.unread > 99 ? '99+' : person.unread}</span>}
      </button>)}
      {loading && !users.length && <p className="chat-empty" role="status">Loading users…</p>}
      {!loading && !users.length && !error && <p className="chat-empty">{query ? 'No matching users.' : 'No available users.'}</p>}
      {snapshot.key === key && snapshot.more && <button type="button" className="chat-load-more" disabled={expanding || disabled} onClick={loadMore}>{expanding ? 'Loading…' : 'More people'}</button>}
      {error && <p className="chat-error" role="alert">{error} <button type="button" disabled={loading || disabled} onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    </div>
  </div>;
}
