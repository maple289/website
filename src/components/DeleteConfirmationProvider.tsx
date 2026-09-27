import { useModalLayer } from '@/hooks/useModalLayer';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Loader2, Trash2 } from 'lucide-react';
import { DeleteConfirmationContext, type DeleteConfirmation } from '@/lib/deleteConfirmation';

type Pending = DeleteConfirmation & { resolve: (confirmed: boolean) => void };

export function DeleteConfirmationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const active = useRef<Pending | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const description = useId();
  useModalLayer(panel, !!pending);
  const requestDelete = useCallback((options: DeleteConfirmation) => {
    // Lock synchronously: rapid clicks cannot open multiple dialogs or requests.
    if (active.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      active.current = next;
      setError(''); setPending(next);
    });
  }, []);
  const finish = (confirmed: boolean) => {
    const previous = active.current;
    active.current = null; setPending(null); setError('');
    previous?.resolve(confirmed);
  };

  useEffect(() => { if (pending) cancel.current?.focus(); }, [pending]);

  const confirm = async () => {
    const operation = active.current;
    if (!operation || running.current) return;
    running.current = true; setBusy(true); setError('');
    panel.current?.focus();
    try { await operation.onConfirm(); finish(true); }
    catch (cause) {
      const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
      setError(message || 'Unable to delete this item. Please try again.');
    } finally { running.current = false; setBusy(false); }
  };
  const value = useMemo(() => ({ requestDelete, isOpen: !!pending }), [requestDelete, pending]);
  return <DeleteConfirmationContext.Provider value={value}>
    {children}
    {pending && createPortal(<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
      onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
      <div ref={panel} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={heading} aria-describedby={description} aria-busy={busy}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl outline-none sm:p-6">
        <AlertTriangle aria-hidden="true" className="mb-4 text-rose-600" size={28} />
        <h2 id={heading} className="text-lg font-semibold">{pending.title ?? 'Confirm deletion'}</h2>
        <div id={description} className="mt-3 space-y-3 break-words text-sm leading-6 text-slate-600">
          <p>{pending.message}</p>{pending.details && <p className="whitespace-pre-line">{pending.details}</p>}
        </div>
        {error && <p role="alert" className="mt-4 break-words rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button ref={cancel} type="button" disabled={busy} onClick={() => { if (!running.current) finish(false); }}
            className="min-h-11 rounded-xl border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{pending.cancelLabel ?? 'Cancel'}</button>
          <button type="button" disabled={busy} onClick={() => void confirm()}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 ${pending.tone === 'primary' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-rose-600 hover:bg-rose-700'}`}>
            {busy ? <Loader2 aria-hidden="true" size={17} className="animate-spin" /> : pending.tone === 'primary' ? <Check aria-hidden="true" size={17} /> : <Trash2 aria-hidden="true" size={17} />}
            {busy ? pending.processingLabel ?? 'Deleting…' : pending.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>, document.body)}
  </DeleteConfirmationContext.Provider>;
}
