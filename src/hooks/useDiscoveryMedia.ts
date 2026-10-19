import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { authenticatedRequest } from '@/lib/authSession';
import { useAuth } from '@/hooks/useAuth';
import type { Photo, Video } from '@/lib/types';

// NONE uses the existing public query. A group uses only its explicit grants,
// never a union with public/owned/person-shared media or another group's grants.
export function useDiscoveryMedia<T extends Photo | Video>(kind: 'video' | 'photo', groupId: string | undefined, enabled = true) {
  const { user } = useAuth();
  const scope = `${user?.id ?? 'guest'}:${kind}:${groupId ?? 'public'}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; items: T[]; loading: boolean; error: string | null } | null>(null);
  const version = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const request = ++version.current;
    if (!enabled) return;
    if (!quiet) setSnapshot({ scope, items: [], loading: true, error: null });
    try {
      let ids: string[] | null = null;
      if (groupId) {
        const { data, error } = await authenticatedRequest(() => supabase.rpc('group_media_ids', { p_type: kind, p_group: groupId }));
        if (request !== version.current) return;
        if (error || !Array.isArray(data) || data.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) throw new Error('Group unavailable');
        ids = data;
      }
      const query = supabase.from(kind === 'video' ? 'videos' : 'photos').select('*');
      const result = ids?.length === 0 ? { data: [], error: null } : await (ids ? query.in('id', ids) : query.eq('visibility', 'public')).order('created_at', { ascending: false });
      if (request !== version.current) return;
      if (result.error) throw result.error;
      setSnapshot({ scope, items: (result.data ?? []) as T[], loading: false, error: null });
    } catch {
      if (request === version.current) setSnapshot({ scope, items: [], loading: false, error: `Could not load ${groupId ? 'group' : 'public'} ${kind === 'video' ? 'videos' : 'photos'}. Please try again.` });
    }
  }, [enabled, groupId, kind, scope]);
  useEffect(() => {
    const requestVersion = version;
    const refresh = () => { void load(); };
    const visible = () => { if (!document.hidden) void load(true); };
    const uploaded = (event: Event) => { if ((event as CustomEvent).detail === kind) refresh(); };
    void load();
    window.addEventListener('media-uploaded', uploaded);
    window.addEventListener('media-access-changed', refresh);
    window.addEventListener('focus', visible);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      requestVersion.current++;
      window.removeEventListener('media-uploaded', uploaded);
      window.removeEventListener('media-access-changed', refresh);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load, kind]);
  const current = snapshot?.scope === scope ? snapshot : null;
  return { items: current?.items ?? [], loading: enabled && (!current || current.loading), error: current?.error ?? null, load };
}
