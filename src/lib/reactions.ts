import { createContext } from 'react';
import { supabase } from './supabase';

export const reactions = [
  { type: 'like', emoji: '👍', label: 'Like' },
  { type: 'dislike', emoji: '👎', label: 'Dislike' },
  { type: 'smile', emoji: '🙂', label: 'Smile' },
  { type: 'lol', emoji: '😂', label: 'LOL' },
  { type: 'love', emoji: '❤️', label: 'Love' },
  { type: 'angry', emoji: '😠', label: 'Angry' },
] as const;
export type Reaction = typeof reactions[number]['type'];
export type MediaType = 'video' | 'photo';
export type ReactionState = {
  counts: Partial<Record<Reaction, number>>;
  own: Reaction | null;
  loaded: boolean;
  available: boolean;
  saving: boolean;
  error: string;
  version: number;
};
type Entry = { type: MediaType; id: string; state: ReactionState; listeners: Set<() => void>; revision: number };

// One cache per signed-in identity: cards and viewers share mutations immediately.
// Only subscribed (near-visible) items are polled; reads are batched in groups of 100.
export class ReactionStore {
  private entries = new Map<string, Entry>();
  private queue = new Set<Entry>();
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private epoch = 0;
  constructor(readonly userId: string | null) {}
  entry(type: MediaType, id: string) {
    const key = `${type}:${id}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { type, id, state: { counts: {}, own: null, loaded: false, available: false, saving: false, error: '', version: 0 }, listeners: new Set(), revision: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }
  subscribe(type: MediaType, id: string, listener: () => void) {
    const entry = this.entry(type, id);
    entry.listeners.add(listener);
    this.refresh(entry);
    return () => { entry.listeners.delete(listener); };
  }
  private publish(entry: Entry, changes: Partial<ReactionState>) {
    entry.state = { ...entry.state, ...changes, version: entry.state.version + 1 };
    entry.listeners.forEach((listener) => listener());
  }
  private refresh(entry: Entry) {
    this.queue.add(entry);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 40);
  }
  start() {
    this.interval = setInterval(this.refreshActive, 20000);
    window.addEventListener('focus', this.refreshActive);
    document.addEventListener('visibilitychange', this.refreshActive);
    this.refreshActive();
  }
  stop() {
    this.epoch++;
    clearInterval(this.interval); clearTimeout(this.timer); this.timer = undefined;
    this.queue.clear();
    window.removeEventListener('focus', this.refreshActive);
    document.removeEventListener('visibilitychange', this.refreshActive);
  }
  private refreshActive = () => {
    if (document.visibilityState === 'hidden') return;
    this.entries.forEach((entry) => { if (entry.listeners.size && !entry.state.saving) this.refresh(entry); });
  };
  private async flush() {
    const epoch = this.epoch;
    const queued = [...this.queue].filter((entry) => entry.listeners.size && !entry.state.saving);
    this.queue.clear();
    for (const type of ['video', 'photo'] as const) {
      const entries = queued.filter((entry) => entry.type === type);
      for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100).map((entry) => ({ entry, revision: ++entry.revision }));
        try {
          const { data, error } = await supabase.rpc('get_media_reactions', { p_type: type, p_ids: batch.map(({ entry }) => entry.id) });
          if (error) throw error;
          if (epoch !== this.epoch) return;
          const rows = (data ?? []) as { media_id: string; counts: ReactionState['counts']; own_reaction: Reaction | null }[];
          const byId = new Map(rows.map((row) => [row.media_id, row]));
          batch.forEach(({ entry, revision }) => {
            if (entry.revision !== revision || entry.state.saving) return;
            const row = byId.get(entry.id);
            this.publish(entry, { counts: row?.counts ?? {}, own: row?.own_reaction ?? null, loaded: true, available: !!row, error: '' });
          });
        } catch {
          if (epoch !== this.epoch) return;
          batch.forEach(({ entry, revision }) => {
            if (entry.revision === revision && !entry.state.saving) this.publish(entry, { error: 'Could not refresh reactions.' });
          });
        }
      }
    }
  }
  async react(type: MediaType, id: string, reaction: Reaction | null) {
    const entry = this.entry(type, id);
    if (!this.userId || !entry.state.available || entry.state.saving) return;
    const previous = entry.state;
    const counts = { ...previous.counts };
    if (previous.own) counts[previous.own] = Math.max(0, (counts[previous.own] ?? 0) - 1);
    if (reaction) counts[reaction] = (counts[reaction] ?? 0) + 1;
    entry.revision++;
    const epoch = this.epoch;
    this.publish(entry, { counts, own: reaction, saving: true, error: '' });
    try {
      const { error } = await supabase.rpc('set_media_reaction', { p_type: type, p_id: id, p_reaction: reaction });
      if (error) throw error;
      if (epoch !== this.epoch) return;
      this.publish(entry, { saving: false });
      this.refresh(entry);
    } catch {
      if (epoch !== this.epoch) return;
      this.publish(entry, { ...previous, saving: false, error: 'Could not save your reaction. Please try again.' });
    }
  }
}
export const ReactionContext = createContext<ReactionStore | null>(null);
