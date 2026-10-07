import { useEffect, useState } from 'react';
import { temporaryShareEndpoint } from '@/lib/temporaryShares';
import { supabaseAnonKey } from '@/lib/supabase';
type Item = { type: string; name: string; mime?: string; entries?: { name: string; relative: string; isFolder: boolean }[]; hasMore?: boolean };

// Deliberately rendered outside the authenticated shell: no owner profile,
// navigation, reactions, management actions or normal folder browsing.
export function TemporarySharePage({ token }: { token: string }) {
  const [relative, setRelative] = useState('');
  const [offset, setOffset] = useState(0);
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const url = `${temporaryShareEndpoint}?apikey=${encodeURIComponent(supabaseAnonKey)}&token=${encodeURIComponent(token)}${relative ? `&child=${encodeURIComponent(relative)}` : ''}`;
  useEffect(() => {
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.append(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setItem(null);
    void fetch(`${url}&metadata=1&offset=${offset}`, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'This share link is no longer available.');
      setItem(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, offset]);
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-10"><div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h1 className="mb-4 text-xl font-semibold">Temporary Share</h1>
    {relative && <button className="mb-4 rounded-lg border p-2" onClick={() => { setRelative(relative.split('/').slice(0, -1).join('/')); setOffset(0); }}>Back</button>}
    {loading && <p role="status">Loading shared item…</p>}
    {error && <p role="alert">{error}</p>}
    {item && <><h2 className="mb-4 break-words font-medium">{item.name}</h2>
      {item.type === 'folder' ? <><ul>{item.entries?.map(entry => <li key={entry.relative}><button className="my-1 min-h-11 w-full rounded-lg border p-3 text-left hover:bg-blue-50" onClick={() => { setRelative(entry.relative); setOffset(0); }}>{entry.isFolder ? '📁 ' : ''}{entry.name}</button></li>)}</ul>
        {offset > 0 && <button className="m-2 rounded-lg border p-2" onClick={() => setOffset(value => Math.max(0, value - 100))}>Previous</button>}
        {item.hasMore && <button className="m-2 rounded-lg border p-2" onClick={() => setOffset(value => value + 100)}>Next</button>}
      </> : <>
        {item.mime?.startsWith('image/') && !item.mime.includes('svg') && <img className="max-h-[70dvh] w-full object-contain" src={url} alt={item.name} onError={() => setError('This share link is no longer available.')} />}
        {item.mime?.startsWith('video/') && <video className="max-h-[70dvh] w-full" controls src={url} onError={() => setError('This share link is no longer available.')} />}
        {item.mime?.startsWith('audio/') && <audio controls src={url} />}
        {item.mime === 'application/pdf' && <iframe title={item.name} src={url} className="h-[65dvh] w-full" />}
        <a className="mt-4 inline-block rounded-lg border px-4 py-3 font-medium text-blue-700" href={`${url}&download=1`} referrerPolicy="no-referrer">Download</a>
      </>}
    </>}
  </div></main>;
}
