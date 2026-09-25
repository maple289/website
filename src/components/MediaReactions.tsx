import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pointerType = useRef('');
  const barTimer = useRef<ReturnType<typeof setTimeout>>();
  const detailsTimer = useRef<ReturnType<typeof setTimeout>>();
  const barId = useId();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState<{ reaction: Reaction; anchor: HTMLButtonElement; focus: boolean } | null>(null);
  const clearBarTimer = () => clearTimeout(barTimer.current);
  const clearDetailsTimer = () => clearTimeout(detailsTimer.current);
  const closeDetails = () => { clearDetailsTimer(); setOpened(null); };
  const deferDetailsClose = () => { clearDetailsTimer(); detailsTimer.current = setTimeout(() => setOpened(null), 280); };
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' });
    observer.observe(root.current);
    return () => { observer.disconnect(); clearTimeout(barTimer.current); clearTimeout(detailsTimer.current); };
  }, []);
  useEffect(() => {
    if (!expanded && !opened) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || popover.current?.contains(target)) return;
      setExpanded(false); setOpened(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (popover.current?.contains(document.activeElement)) opened?.anchor.focus({ preventScroll: true });
      else if (root.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
      setExpanded(false); setOpened(null);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [expanded, opened]);
  const active = visible || expanded || !!opened;
  const subscribe = useCallback((listener: () => void) => active
    ? store.subscribe(mediaType, mediaId, listener) : () => {}, [store, mediaType, mediaId, active]);
  const snapshot = useCallback(() => store.entry(mediaType, mediaId).state, [store, mediaType, mediaId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const selected = reactions.find((reaction) => reaction.type === state.own);
  const apply = (reaction: Reaction | null) => {
    clearBarTimer(); setExpanded(false); closeDetails();
    trigger.current?.focus({ preventScroll: true });
    void store.react(mediaType, mediaId, reaction);
  };
  return <div ref={root} className="media-reactions" data-reaction-control onClick={(event) => event.stopPropagation()}>
    {store.userId ? <div className="reaction-selector"
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') { clearBarTimer(); if (state.available && !state.saving) setExpanded(true); } }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') { clearBarTimer(); barTimer.current = setTimeout(() => setExpanded(false), 280); } }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }}>
      <button ref={trigger} type="button" className={`reaction-add ${selected ? 'is-selected' : ''}`}
        aria-label={selected ? `Your reaction: ${selected.label}. Change or remove reaction` : 'Add reaction'}
        aria-expanded={expanded} aria-controls={barId} disabled={!state.loaded || !state.available || state.saving}
        onPointerDown={(event) => { pointerType.current = event.pointerType; }}
        onClick={(event) => { clearBarTimer(); closeDetails(); setExpanded((value) => pointerType.current === 'mouse' && event.detail > 0 ? true : !value); }}>
        {selected ? <span aria-hidden="true">{selected.emoji}</span> : <SmilePlus size={16} />}
        <span>{selected ? selected.label : 'React'}</span>
      </button>
      <div id={barId} className="reaction-bar-expander" data-expanded={expanded} aria-hidden={!expanded}>
        <div className="reaction-bar-clip"><div className="reaction-bar" role="group" aria-label="Choose your reaction">
          {reactions.map((reaction) => <button key={reaction.type} type="button" title={reaction.label}
            aria-label={state.own === reaction.type ? `Remove ${reaction.label} reaction` : reaction.label} aria-pressed={state.own === reaction.type}
            disabled={state.saving || !state.available} onClick={() => apply(state.own === reaction.type ? null : reaction.type)}>
            <span aria-hidden="true">{reaction.emoji}</span>
          </button>)}
          {state.own && <button type="button" className="reaction-remove" disabled={state.saving} onClick={() => apply(null)}>Remove reaction</button>}
        </div></div>
      </div>
    </div> : <span className="reaction-guest">Sign in to react</span>}
    <div className="reaction-summary" role="group" aria-label="Reaction counts">
      {reactions.filter((reaction) => (state.counts[reaction.type] ?? 0) > 0).map((reaction) => <button key={reaction.type} type="button"
        className={`reaction-count ${state.own === reaction.type ? 'is-selected' : ''}`} aria-label={`${reaction.label}: ${state.counts[reaction.type]}. See who reacted`}
        aria-expanded={opened?.reaction === reaction.type}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') { clearDetailsTimer(); setOpened({ reaction: reaction.type, anchor: event.currentTarget, focus: false }); } }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') deferDetailsClose(); }}
        onClick={(event) => { clearDetailsTimer(); setExpanded(false); setOpened({ reaction: reaction.type, anchor: event.currentTarget, focus: true }); }}>
        <span aria-hidden="true">{reaction.emoji}</span><span>{state.counts[reaction.type]}</span>
      </button>)}
    </div>
    {state.error && <p className="reaction-error" role="alert">{state.error}</p>}
    {opened && <ReactionDetails key={opened.reaction} mediaType={mediaType} mediaId={mediaId} state={state} selected={opened.reaction}
      anchor={opened.anchor} focus={opened.focus} popoverRef={popover} onClose={closeDetails} onEnter={clearDetailsTimer} onLeave={deferDetailsClose} />}
  </div>;
}

type Person = { user_id: string; display_name: string };
function ReactionDetails({ mediaType, mediaId, state, selected, anchor, focus, popoverRef, onClose, onEnter, onLeave }: Props & {
  state: ReactionState; selected: Reaction; anchor: HTMLButtonElement; focus: boolean;
  popoverRef: React.RefObject<HTMLDivElement>; onClose: () => void; onEnter: () => void; onLeave: () => void;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => { if (focus) popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }, [focus, popoverRef]);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor.getBoundingClientRect();
      const box = popoverRef.current?.getBoundingClientRect();
      const width = box?.width ?? 280, height = box?.height ?? 220;
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
      const top = Math.max(8, Math.min(bounds.bottom + height + 8 <= window.innerHeight ? bounds.bottom + 6 : bounds.top - height - 6, window.innerHeight - height - 8));
      setPosition({ top, left });
    };
    place();
    const observer = new ResizeObserver(place);
    if (popoverRef.current) observer.observe(popoverRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, popoverRef]);
  const [people, setPeople] = useState<Person[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  return createPortal(<div ref={popoverRef} className="reaction-details" style={position} data-reaction-control
    role="region" aria-label={`${current.label} reactions`}
    onPointerEnter={(event) => { if (event.pointerType === 'mouse') onEnter(); }}
    onPointerLeave={(event) => { if (event.pointerType === 'mouse') onLeave(); }}
    onFocus={onEnter} onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}>
    <header><strong>{current.emoji} {current.label}</strong><button type="button" onClick={() => { anchor.focus({ preventScroll: true }); onClose(); }} aria-label="Close reaction details"><X size={16} /></button></header>
    <div className="reaction-people" aria-busy={loading}>
      {loading ? <p role="status">Loading…</p> : error ? <p role="alert">{error}</p> : people.length ? <ul>{people.map((person) => <li key={person.user_id}>{person.display_name}</li>)}</ul> : <p>No reactions on this page.</p>}
    </div>
    {(hasMore || cursors.length > 1) && <footer><button type="button" disabled={loading || cursors.length === 1} onClick={() => setCursors((value) => value.slice(0, -1))}>Previous</button>
      <span>Page {cursors.length}</span><button type="button" disabled={loading || !hasMore} onClick={() => setCursors((value) => [...value, people[people.length - 1].user_id])}>Next</button></footer>}
  </div>, document.body);
}
