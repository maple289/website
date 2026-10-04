import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type SystemLoad = {
  cpuOverall: number | null;
  cpuCount: number | null;
  cpus: { id: number; usage: number | null }[];
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  memoryPercent: number | null;
  videoProcessing: { converting: number; queued: number };
  sampleSeconds: number | null;
  collectedAt: string | null;
  stale: boolean;
};

// One request loop shared by the sidebar and the dedicated System Load page.
export function useSystemLoad(enabled: boolean, accountKey?: string) {
  const [data, setData] = useState<SystemLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setError(null);
    if (!enabled) return;
    let disposed = false;
    let pending = false;
    let unauthorized = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (disposed || pending || document.hidden || unauthorized) return;
      pending = true;
      const request = new AbortController();
      controller = request;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; request.abort(); }, 8000);
      try {
        const result = await supabase.rpc('admin_system_load').abortSignal(request.signal);
        if (disposed) return;
        if (timedOut) throw new Error('System readings timed out. Retrying…');
        if (request.signal.aborted) return;
        if (result.error) {
          unauthorized = result.error.code === '42501';
          if (unauthorized) setData(null);
          throw new Error(unauthorized ? 'Administrator access is required.' : 'System readings could not be refreshed.');
        }
        if (!result.data) throw new Error('System readings are unavailable.');
        setData(result.data as SystemLoad); setError(null);
      } catch (caught) {
        if (!disposed && (timedOut || !request.signal.aborted)) {
          setError(timedOut ? 'System readings timed out. Retrying…' : caught instanceof Error ? caught.message : 'System readings could not be refreshed.');
          setData(current => current ? { ...current, stale: true } : null);
        }
      } finally {
        clearTimeout(timeout); controller = undefined; pending = false;
        if (!disposed && !document.hidden && !unauthorized) timer = setTimeout(() => void poll(), 3000);
      }
    };
    const visibilityChanged = () => {
      clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else void poll();
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    void poll();
    return () => {
      disposed = true; clearTimeout(timer); controller?.abort();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [enabled, accountKey]);
  return { data, error };
}
