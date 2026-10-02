import { lazy, Suspense, useEffect, useState } from 'react';
import { Download, FileText, LoaderCircle, X } from 'lucide-react';
import { TaskModal } from '@/components/TaskModal';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import type { FileEntry } from '@/lib/fileTree';
import { downloadFile } from '@/lib/publicFiles';
import { boundedPreviewBlob, decodePreviewText, filePreviewKind, parsePreviewCsv, requestFilePreview, type PreviewKind, type PreviewStatus } from '@/lib/filePreviews';

type State = { status: 'loading' | 'generating' | 'ready' | 'failed' | 'unsupported'; kind?: PreviewKind; url?: string; text?: string; csv?: ReturnType<typeof parsePreviewCsv>; message?: string };
const PdfFilePreview = lazy(() => import('./PdfFilePreview').then(module => ({ default: module.PdfFilePreview })));

export function FilePreview({ entry, onClose, onDownload }: { entry: FileEntry; onClose: () => void; onDownload: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let objectUrl = '';
    const wait = () => new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = window.setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 2000);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
    const load = async () => {
      const kind = filePreviewKind(entry);
      if (!kind) { setState({ status: 'unsupported' }); return; }
      setState({ status: 'loading', kind });
      try {
        // Preserve the existing video player/download authorization path.
        if (kind === 'video') {
          const { data, error } = await downloadFile(entry);
          signal.throwIfAborted();
          if (error || !data) throw new Error(error?.message || 'Video preview could not be loaded.');
          objectUrl = URL.createObjectURL(data);
          setState({ status: 'ready', kind, url: objectUrl });
          return;
        }
        const start = Date.now();
        while (!signal.aborted) {
          if (Date.now() - start > 5 * 60 * 1000) throw new Error('The preview is still queued. Please reopen it shortly. You can still download the original file.');
          if (document.hidden) { await wait(); continue; }
          const response = await requestFilePreview(entry, false, signal);
          const status = await response.json() as PreviewStatus;
          if (!response.ok && response.status !== 202) throw new Error(status.message || 'Preview could not be loaded.');
          if (status.status === 'generating') { setState({ status: 'generating', kind, message: status.queued ? 'Waiting for a preview worker…' : undefined }); await wait(); continue; }
          if (status.status !== 'available') { setState({ status: status.status, message: status.message }); return; }
          const content = await requestFilePreview(entry, true, signal);
          if (content.headers.get('content-type')?.includes('application/json')) {
            const changed = await content.json() as PreviewStatus;
            if (changed.status === 'generating') { setState({ status: 'generating', kind }); await wait(); continue; }
            throw new Error(changed.message || 'Preview could not be loaded.');
          }
          if (!content.ok) throw new Error('Preview could not be loaded.');
          const actualKind = status.kind ?? kind;
          const blob = await boundedPreviewBlob(content, actualKind, signal);
          signal.throwIfAborted();
          if (actualKind === 'text' || actualKind === 'csv') {
            let text = decodePreviewText(await blob.arrayBuffer());
            signal.throwIfAborted();
            if (actualKind === 'csv') setState({ status: 'ready', kind: 'csv', csv: parsePreviewCsv(text) });
            else {
              if (entry.name.toLowerCase().endsWith('.json')) { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Show invalid JSON as safe plain text. */ } }
              setState({ status: 'ready', kind: 'text', text });
            }
          } else {
            if (actualKind === 'pdf' && !(await blob.slice(0, 1024).text()).includes('%PDF-')) throw new Error('This file is not a readable PDF. You can still download the original file.');
            signal.throwIfAborted();
            objectUrl = URL.createObjectURL(blob);
            setState({ status: 'ready', kind: actualKind, url: objectUrl });
          }
          return;
        }
      } catch (error) {
        if (!signal.aborted) setState({ status: 'failed', message: error instanceof Error ? error.message : 'Preview could not be generated. You can still download the original file.' });
      }
    };
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entry]);
  const loading = state.status === 'loading' || state.status === 'generating';
  return <TaskModal aria-label="File preview" className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-2 sm:p-6">
    <section className="flex h-[90dvh] max-h-full w-full max-w-6xl min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2 sm:px-5 sm:py-3">
        <FileTypeIcon entry={entry} size={24} />
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-slate-800" title={entry.name}>{entry.name}</h2><p className="text-xs text-slate-500">Read-only preview · Original file unchanged</p></div>
        <button onClick={onDownload} aria-label="Download original file" title="Download original file" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><Download size={19} /></button>
        <button onClick={onClose} aria-label="Close preview" title="Close preview" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={20} /></button>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-slate-100 p-2 sm:p-4" aria-busy={loading}>
        {loading ? <div role="status" className="m-auto px-4 text-center"><LoaderCircle size={32} className="mx-auto mb-3 animate-spin text-blue-600" /><p className="font-semibold text-slate-800">{state.status === 'generating' ? 'Generating preview…' : 'Loading preview…'}</p><p className="mt-2 text-sm text-slate-500">{state.message || 'You can close this window while the preview is prepared.'}</p></div>
          : state.status !== 'ready' ? <div role="status" className="m-auto max-w-md px-4 text-center"><FileText size={44} className="mx-auto mb-3 text-slate-400" /><h3 className="font-semibold text-slate-800">{state.status === 'unsupported' ? 'Preview is not available for this file type' : 'Preview could not be generated'}</h3><p className="mt-2 break-words text-sm text-slate-600">{state.message || `You can still download the original file (${(entry.size / 1048576).toFixed(2)} MB).`}</p><button onClick={onDownload} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">Download original file</button></div>
          : state.kind === 'pdf' && state.url ? <Suspense fallback={<p role="status" className="m-auto text-sm text-slate-500">Loading PDF viewer…</p>}><PdfFilePreview url={state.url} name={entry.name} /></Suspense>
          : state.kind === 'image' ? <img src={state.url} alt={entry.name} onError={() => setState({ status: 'failed', message: 'This image could not be decoded. You can still download the original file.' })} className="m-auto max-h-full max-w-full object-contain" />
          : state.kind === 'video' ? <video src={state.url} controls className="m-auto max-h-full max-w-full" />
          : state.kind === 'csv' && state.csv ? <><p className="mb-2 shrink-0 text-xs text-slate-500">{state.csv.truncated ? 'Showing up to 200 rows, 50 columns and 2,000 characters per cell. Download the original for all data.' : `${state.csv.rows.length} rows · Read-only table`}</p><div className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white"><table className="w-full border-collapse text-left text-sm text-slate-800"><tbody>{state.csv.rows.map((row, index) => <tr key={index} className={index % 2 ? 'bg-slate-50' : ''}>{row.map((cell, column) => <td key={column} className="min-w-[100px] max-w-xs whitespace-pre-wrap break-words border border-slate-100 px-3 py-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div></>
          : <pre className="min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-4 font-mono text-sm text-slate-800">{state.text || '(Empty file)'}</pre>}
      </div>
      {state.status === 'ready' && state.kind === 'pdf' && <p className="shrink-0 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Scroll through pages or use the PDF controls.{filePreviewKind(entry) === 'office' ? ' Office previews show up to 200 pages.' : ''}</p>}
    </section>
  </TaskModal>;
}
