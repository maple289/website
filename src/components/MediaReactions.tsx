import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { SmilePlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ReactionContext, reactions, type MediaType, type Reaction, type ReactionState, type ReactionStore } from '@/lib/reactions';
import './MediaReactions.css';

type Props = { mediaType: MediaType; mediaId: string };
export function MediaReactions({ mediaType, mediaId }: Props) {
  const store = useContext(ReactionContext);
  if (!store) return null;
  return <ReactionControl key={`${mediaType}:${mediaId}:${store.userId}`} store={store} mediaType={mediaType} mediaId={mediaId} />;
}

function ReactionControl({ store, mediaType, mediaId }: Props & { store: ReactionStore }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [opened, setOpened] = useState<Reaction | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const subscribe = useCallback((listener: () => void) => visible || opened
    ? store.subscribe(mediaType, mediaId, listener) : () => {}, [store, mediaType, mediaId, visible, opened]);
  const snapshot = useCallback(() => store.entry(mediaType, mediaId).state, [store, mediaType, mediaId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const selected = reactions.find((reaction) => reaction.type === state.own);
  return <div ref={root} className="media-reactions" data-reaction-control onClick={(event) => event.stopPropagation()}>
    <div className="reaction-summary" role="group" aria-label="Media reactions">
      <button type="button" className="reaction-add" aria-label={selected ? `Your reaction: ${selected.label}. Change or remove reaction` : store.userId ? 'Add reaction' : 'View reactions'}
        aria-haspopup="dialog" disabled={!state.loaded || !state.available} onClick={() => setOpened(state.own ?? 'like')}>
        {selected ? <span aria-hidden="true">{selected.emoji}</span> : <SmilePlus size={16} />}
        <span>{selected ? selected.label : store.userId ? 'React' : 'Reactions'}</span>
      </button>
      {reactions.filter((reaction) => (state.counts[reaction.type] ?? 0) > 0).map((reaction) => <button key={reaction.type} type="button"
        className={`reaction-count ${state.own === reaction.type ? 'is-selected' : ''}`} aria-label={`${reaction.label}: ${state.counts[reaction.type]}. See who reacted`}
        aria-haspopup="dialog" onClick={() => setOpened(reaction.type)}><span aria-hidden="true">{reaction.emoji}</span><span>{state.counts[reaction.type]}</span></button>)}
    </div>
    {state.error && <p className="reaction-error" role="alert">{state.error}</p>}
    {opened && <ReactionDialog store={store} mediaType={mediaType} mediaId={mediaId} state={state} initialReaction={opened} onClose={() => setOpened(null)} />}
  </div>;
}

type Person = { user_id: string; display_name: string };
function ReactionDialog({ store, mediaType, mediaId, state, initialReaction, onClose }: Props & {
  store: ReactionStore; state: ReactionState; initialReaction: Reaction; onClose: () => void;
}) {
  const [selected, setSelected] = useState(initialReaction);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const [people, setPeople] = useState<Person[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    const lockScroll = bodyOverflow !== 'hidden';
    if (lockScroll) document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (lockScroll) document.body.style.overflow = bodyOverflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setPeople([]); setHasMore(false);
    if (state.saving) return () => { active = false; };
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_media_reaction_users', {
          p_type: mediaType, p_id: mediaId, p_reaction: selected, p_after: cursor,
        });
        if (!active) return;
        if (error) throw error;
        const rows = (data ?? []) as Person[];
        setPeople(rows.slice(0, 50)); setHasMore(rows.length > 50);
      } catch {
        if (active) setError('Could not load reaction details. Close and reopen to try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [mediaType, mediaId, selected, cursor, state.version, state.saving]);
  const current = reactions.find((reaction) => reaction.type === selected)!;
  return createPortal(<div className="reaction-overlay" data-reaction-control onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
    onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div ref={dialog} className="reaction-dialog" role="dialog" aria-modal="true" aria-label="Media reactions">
      <header><h2>Reactions</h2><button type="button" onClick={onClose} aria-label="Close reactions"><X size={20} /></button></header>
      {store.userId ? <>
        <p>Choose a reaction. Select it again to remove it.</p>
        <div className="reaction-picker" role="group" aria-label="Choose your reaction">
          {reactions.map((reaction) => <button key={reaction.type} type="button" aria-pressed={state.own === reaction.type}
            disabled={state.saving || !state.available} onClick={() => { setSelected(reaction.type); setCursors([null]); void store.react(mediaType, mediaId, state.own === reaction.type ? null : reaction.type); }}>
            <span aria-hidden="true">{reaction.emoji}</span>{reaction.label}
          </button>)}
        </div>
        <p role="status">{state.saving ? 'Saving…' : state.own ? `Your reaction: ${reactions.find((reaction) => reaction.type === state.own)?.label}` : 'You have not reacted.'}</p>
      </> : <p>Sign in to add a reaction.</p>}
      {state.error && <p className="reaction-error" role="alert">{state.error}</p>}
      <div className="reaction-tabs" role="group" aria-label="Show reactions by type">
        {reactions.map((reaction) => <button key={reaction.type} type="button" aria-pressed={selected === reaction.type}
          aria-label={`${reaction.label}: ${state.counts[reaction.type] ?? 0}`} onClick={() => { setSelected(reaction.type); setCursors([null]); }}>
          <span aria-hidden="true">{reaction.emoji}</span> {state.counts[reaction.type] ?? 0}
        </button>)}
      </div>
      <h3>{current.emoji} {current.label}</h3>
      <div className="reaction-people" aria-busy={loading}>
        {loading ? <p role="status">Loading…</p> : error ? <p role="alert">{error}</p> : people.length ? <ul>{people.map((person) => <li key={person.user_id}>{person.display_name}</li>)}</ul> : <p>No reactions on this page.</p>}
      </div>
      <footer><button type="button" disabled={loading || cursors.length === 1} onClick={() => setCursors((value) => value.slice(0, -1))}>Previous</button>
        <span>Page {cursors.length}</span><button type="button" disabled={loading || !hasMore} onClick={() => setCursors((value) => [...value, people[people.length - 1].user_id])}>Next</button></footer>
    </div>
  </div>, document.body);
}
