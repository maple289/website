import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

type Job = { id: string; file_name: string; status: 'queued' | 'processing' | 'complete' | 'error'; error: string | null; visibility: 'public' | 'private' };

// Jobs are owner-only under RLS. Unvalidated uploads never enter public videos.
export function VideoProcessingJobs({ searchTerm, visibleIds }: { searchTerm: string; visibleIds: string[] }) {
  const { user } = useAuth();
  const ownerId = user?.id;
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setJobs([]); setUnavailable(false);
    if (!ownerId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let busy = false;
    const completed = new Set<string>();
    const load = async () => {
      if (busy || disposed) return;
      busy = true;
      try {
        const query = () => supabase.from('media_upload_jobs').select('id,file_name,status,error,visibility').eq('owner_id', ownerId).eq('kind', 'video').order('created_at', { ascending: false });
        const [active, recent] = await Promise.all([
          query().in('status', ['queued', 'processing']).limit(30),
          query().in('status', ['complete', 'error']).limit(30),
        ]);
        if (disposed) return;
        if (active.error || recent.error) { setUnavailable(true); return; }
        setUnavailable(false);
        const rows = Array.from(new Map([...active.data, ...recent.data].map(row => [row.id, row as Job])).values());
        setLoadedOwner(ownerId); setJobs(rows);
        const newlyReady = rows.filter(row => row.status === 'complete' && !completed.has(row.id));
        newlyReady.forEach(row => completed.add(row.id));
        if (newlyReady.length) window.dispatchEvent(new CustomEvent('media-uploaded', { detail: 'video' }));
      } catch { if (!disposed) setUnavailable(true); }
      finally {
        busy = false;
        if (!disposed) { clearTimeout(timer); timer = setTimeout(() => void load(), 5000); }
      }
    };
    const refresh = () => { clearTimeout(timer); void load(); };
    window.addEventListener('media-processing', refresh);
    void load();
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('media-processing', refresh); };
  }, [ownerId]);
  if (!ownerId || (loadedOwner !== ownerId && !unavailable)) return null;
  const filtered = loadedOwner === ownerId ? jobs.filter(job => !visibleIds.includes(job.id) && job.file_name.toLowerCase().includes(searchTerm.trim().toLowerCase())) : [];
  return <>
    {unavailable && <p role="status" className="mb-4 text-sm text-amber-600">Processing status is temporarily unavailable. Server jobs continue; this page will retry automatically.</p>}
    {filtered.length > 0 && <section aria-label="Your video processing jobs" className="mb-6">
      <h2 className="mb-3 text-sm font-semibold">Your uploads</h2>
      <div className="mg-grid">{filtered.map(job => {
        const ready = job.status === 'complete', failed = job.status === 'error';
        return <article key={job.id} className="mg-card">
          <div className="mg-thumbnail mg-video-thumbnail mg-placeholder mg-processing">
            {ready ? <CheckCircle2 size={28} /> : failed ? <AlertCircle size={28} /> : <LoaderCircle size={28} className="animate-spin" />}
            <span role="status">{ready ? 'Ready' : failed ? 'Processing Failed' : 'Processing'}</span>
          </div>
          <div className="mg-card-body">
            <h3 className="mg-title" title={job.file_name}>{job.file_name}</h3>
            <p className="mg-meta">{job.visibility === 'private' ? 'Private' : 'Public'}{job.status === 'queued' ? ' · Waiting for a processing slot' : ''}</p>
            {failed && <p className="mg-error">{job.error || 'Unable to process this video. Please upload a supported, undamaged source.'}</p>}
            {ready && <a className="inline-flex min-h-11 items-center text-sm text-blue-500" href="#/library">Open My Videos</a>}
          </div>
        </article>;
      })}</div>
    </section>}
  </>;
}
