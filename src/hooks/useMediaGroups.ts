import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedRequest } from '@/lib/authSession';
import { supabase } from '@/lib/supabase';

export type MediaGroup = { id: string; name: string };

export function useMediaGroups(userId: string | undefined) {
  const [snapshot, setSnapshot] = useState<{ owner: string; groups: MediaGroup[]; loading: boolean; error: boolean } | null>(null);
  const [selection, setSelection] = useState<{ owner: string; group: MediaGroup } | null>(null);
  const version = useRef(0);
  const reload = useCallback(async () => {
    const request = ++version.current;
    if (!userId) return;
    setSnapshot(current => ({ owner: userId, groups: current?.owner === userId ? current.groups : [], loading: true, error: false }));
    try {
      const { data, error } = await authenticatedRequest(() => supabase.rpc('media_filter_groups'));
      if (request !== version.current) return;
      if (error || !Array.isArray(data) || data.some(g => typeof g?.id !== 'string' || typeof g?.name !== 'string')) throw new Error('Groups unavailable');
      const groups = data as MediaGroup[];
      setSnapshot({ owner: userId, groups, loading: false, error: false });
      setSelection(current => current?.owner === userId && groups.some(g => g.id === current.group.id) ? current : null);
    } catch {
      if (request === version.current) setSnapshot(current => ({ owner: userId, groups: current?.owner === userId ? current.groups : [], loading: false, error: true }));
    }
  }, [userId]);
  useEffect(() => {
    const requestVersion = version;
    const refresh = () => { void reload(); };
    const visible = () => { if (!document.hidden) refresh(); };
    void reload();
    window.addEventListener('media-access-changed', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      requestVersion.current++;
      window.removeEventListener('media-access-changed', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reload]);
  const state = snapshot?.owner === userId ? snapshot : null;
  const selected = selection && selection.owner === userId ? selection.group : null;
  // Resolve renames against the latest authorized list without losing the filter
  // while a refresh is pending or fails.
  const group = state?.groups.find(g => g.id === selected?.id) ?? selected;
  return { groups: state?.groups ?? [], group, loading: !!userId && (!state || state.loading), error: !!state?.error, reload,
    select: (id: string) => { const next = state?.groups.find(g => g.id === id); setSelection(userId && next ? { owner: userId, group: next } : null); } };
}
