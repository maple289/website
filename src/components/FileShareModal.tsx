import { useEffect, useRef, useState } from 'react';
import { Check, Globe, LoaderCircle, Search, Share2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ShareUser = { id: string; email: string };
type Grant = { recipient_id: string | null; email: string | null; source_path: string; inherited: boolean };
const message = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Could not update sharing.';

export function FileShareModal({ path, name, isFolder, ownerEmail, onClose, onSaved }: {
  path: string; name: string; isFolder: boolean; ownerEmail: string; onClose: () => void; onSaved: () => void;
}) {
  const [users, setUsers] = useState<ShareUser[]>([]);
  const [inherited, setInherited] = useState<Grant[]>([]);
  const [everyone, setEveryone] = useState(false);
  const [confirmEveryone, setConfirmEveryone] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShareUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const modal = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    supabase.rpc('get_user_file_sharing', { p_path: path }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) { setError(rpcError.message); return; }
      const grants = (data ?? []) as Grant[];
      setUsers(grants.filter((g) => !g.inherited && g.recipient_id).map((g) => ({ id: g.recipient_id!, email: g.email ?? 'Registered user' })));
      setEveryone(grants.some((g) => !g.inherited && !g.recipient_id));
      setInherited(grants.filter((g) => g.inherited));
      setLoading(false);
    });
    return () => { active = false; };
  }, [path]);

  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    setSearching(false);
    if (query.trim().length < 2) return () => controller.abort();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const { data, error: rpcError } = await supabase.rpc('search_file_share_users', { p_path: path, p_query: query.trim() }).abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (rpcError) setError(rpcError.message);
      else setResults((data ?? []) as ShareUser[]);
      setSearching(false);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [path, query]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modal.current?.focus();
    return () => previous?.focus();
  }, []);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const { error: rpcError } = await supabase.rpc('set_user_file_sharing', { p_path: path, p_recipients: users.map((u) => u.id), p_everyone: everyone });
      if (rpcError) throw rpcError;
      onSaved();
    } catch (err) { setError(message(err)); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <div ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="share-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 text-slate-800 shadow-2xl outline-none" onKeyDown={(e) => {
      if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const elements = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="mb-4 flex items-center gap-3"><Share2 size={21} className="text-blue-600" /><h2 id="share-title" className="min-w-0 flex-1 truncate text-lg font-semibold">Share {name}</h2><button disabled={saving} onClick={onClose} aria-label="Close sharing" className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></div>
      <p className="mb-4 text-sm text-slate-500">Shared users can view and download. Only you can edit, move, delete, or manage sharing.{isFolder && ' Current and future files and subfolders inherit this access.'}</p>
      {error && <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading ? <p className="text-sm text-slate-500">{error ? 'Close and reopen to retry loading permissions.' : 'Loading permissions…'}</p> : <>
        <div className="mb-4 rounded-xl border border-slate-200 p-3"><p className="text-sm font-medium">{ownerEmail || 'You'} <span className="float-right text-xs text-slate-500">Owner</span></p><p className="mt-1 text-xs text-slate-500">You always retain access.</p></div>
        <label className="mb-2 block text-sm font-medium" htmlFor="share-search">Add registered users</label>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3"><Search size={16} className="text-slate-400" /><input id="share-search" disabled={saving} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by email (at least 2 characters)" className="h-11 min-w-0 flex-1 text-sm outline-none" /></div>
        {searching && <p role="status" className="mt-2 text-xs text-slate-500">Searching…</p>}
        {query.trim().length >= 2 && !searching && results.length === 0 && <p className="mt-2 text-xs text-slate-500">No matching users.</p>}
        <div className="mt-2 max-h-36 overflow-y-auto">{results.map((u) => <button key={u.id} disabled={saving || users.some((v) => v.id === u.id)} onClick={() => { setUsers((current) => [...current, u]); setQuery(''); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50 disabled:opacity-50"><span className="truncate">{u.email}</span><span>{users.some((v) => v.id === u.id) ? <Check size={15} /> : 'Add'}</span></button>)}</div>
        <h3 className="mb-2 mt-4 text-sm font-semibold">People with access</h3>
        {users.length === 0 && <p className="text-xs text-slate-500">No individual users added to this item.</p>}
        {users.map((u) => <div key={u.id} className="flex items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{u.email}</span><span className="text-xs text-slate-400">Viewer</span><button disabled={saving} onClick={() => setUsers((current) => current.filter((v) => v.id !== u.id))} aria-label={`Remove ${u.email}`} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"><X size={15} /></button></div>)}
        <label className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm"><Globe size={19} className="text-blue-600" /><span className="flex-1">Everyone <span className="block text-xs text-slate-500">Anyone, including guests</span></span><input type="checkbox" checked={everyone} disabled={saving} onChange={(e) => { if (e.target.checked) setConfirmEveryone(true); else { setEveryone(false); setConfirmEveryone(false); } }} /></label>
        {confirmEveryone && <div role="alert" className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>Anyone, including people who are not signed in, will be able to view and download this {isFolder ? 'folder and everything inside it, including future additions' : 'file'}. Enable this access?</p><div className="mt-2 flex gap-3"><button onClick={() => { setEveryone(true); setConfirmEveryone(false); }} className="font-semibold">Enable Everyone</button><button onClick={() => setConfirmEveryone(false)}>Cancel</button></div></div>}
        {inherited.length > 0 && <div className="mt-4 rounded-xl bg-blue-50 p-3 text-xs text-blue-900"><p className="mb-2 font-semibold">Access inherited from parent folders</p>{inherited.map((g) => <p key={`${g.source_path}-${g.recipient_id}`}>{g.email ?? 'Everyone (including guests)'} — {g.source_path.split('/').slice(1).join('/')}</p>)}<p className="mt-2">To remove inherited access, manage sharing on the named parent folder. Disabling Everyone here does not remove a parent folder’s grant.</p></div>}
        <p className="mt-4 text-xs text-slate-500">Changes take effect when you save.</p>
        <div className="mt-5 flex justify-end gap-2"><button disabled={saving} onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm hover:bg-slate-100">Cancel</button><button disabled={saving || confirmEveryone} onClick={() => void save()} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <LoaderCircle size={16} className="animate-spin" />}Save sharing</button></div>
      </>}
    </div>
  </div>;
}
