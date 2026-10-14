import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuthContext } from '@/context/AuthContext';
import { Download, FileText, LoaderCircle, X } from 'lucide-react';
import { TaskModal } from '@/components/TaskModal';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import type { FileEntry } from '@/lib/fileTree';
import { downloadFile } from '@/lib/publicFiles';
import { boundedPreviewBlob, decodePreviewText, filePreviewKind, parsePreviewCsv, requestFilePreview, type PreviewKind, type PreviewStatus } from '@/lib/filePreviews';
import { analyticsRequestId, recordFileEvent } from '@/lib/analytics';
import { useVideoCompletion } from '@/hooks/useVideoCompletion';
import { VideoPresentationControls } from './VideoPresentationControls';

type State = { status: 'loading' | 'generating' | 'ready' | 'failed' | 'unsupported'; kind?: PreviewKind; url?: string; text?: string; csv?: ReturnType<typeof parsePreviewCsv>; message?: string };
const PdfFilePreview = lazy(() => import('./PdfFilePreview').then(module => ({ default: module.PdfFilePreview })));

export function FilePreview({ entry, onClose, onDownload, allowDownload = true, requestPreview = requestFilePreview, loadVideo, trackViews = true }: {
  entry: FileEntry; onClose: () => void; onDownload: () => void;
  allowDownload?: boolean; requestPreview?: typeof requestFilePreview; loadVideo?: (entry: FileEntry, signal: AbortSignal) => Promise<Blob>; trackViews?: boolean;
}) {
  const auth = useContext(AuthContext);
  const [state, setState] = useState<State>({ status: 'loading' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const completion = useVideoCompletion(videoRef, playerRef, state.kind === 'video' ? state.url : null, onClose);
  const previewEvent = useRef({ path: entry.path, requestId: analyticsRequestId(), sent: false });
  const readySource = useRef('');
  useEffect(() => {
    if (!trackViews || state.status !== 'ready' || readySource.current !== entry.path) return;
    if (previewEvent.current.path !== entry.path) previewEvent.current = { path: entry.path, requestId: analyticsRequestId(), sent: false };
    if (!previewEvent.current.sent) { previewEvent.current.sent = true; recordFileEvent(entry, 'preview', previewEvent.current.requestId); }
  }, [state.status, entry, trackViews]);
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
      readySource.current = '';
      if (!kind) { setState({ status: 'unsupported' }); return; }
      setState({ status: 'loading', kind });
      try {
        // Preserve the existing video player/download authorization path.
        if (kind === 'video') {
          const { data, error } = loadVideo ? { data: await loadVideo(entry, signal), error: null } : await downloadFile(entry);
          signal.throwIfAborted();
          if (error || !data) throw new Error(error?.message || 'Video preview could not be loaded.');
          objectUrl = URL.createObjectURL(data);
          readySource.current = entry.path;
          setState({ status: 'ready', kind, url: objectUrl });
          return;
        }
        const start = Date.now();
        while (!signal.aborted) {
          if (Date.now() - start > 5 * 60 * 1000) throw new Error('The preview is still queued. Please reopen it shortly. You can still download the original file.');
          if (document.hidden) { await wait(); continue; }
          const response = await requestPreview(entry, false, signal);
          const status = await response.json() as PreviewStatus;
          if (!response.ok && response.status !== 202) throw new Error(status.message || 'Preview could not be loaded.');
          if (status.status === 'generating') { setState({ status: 'generating', kind, message: status.queued ? 'Waiting for a preview worker…' : undefined }); await wait(); continue; }
          if (status.status !== 'available') { setState({ status: status.status, message: status.message }); return; }
          const content = await requestPreview(entry, true, signal);
          if (content.headers.get('content-type')?.includes('application/json')) {
            const changed = await content.json() as PreviewStatus;
            if (changed.status === 'generating') { setState({ status: 'generating', kind }); await wait(); continue; }
            throw new Error(changed.message || 'Preview could not be loaded.');
          }
          if (!content.ok) throw new Error('Preview could not be loaded.');
          const actualKind = status.kind ?? kind;
          const blob = await boundedPreviewBlob(content, actualKind, signal);
          signal.throwIfAborted();
          readySource.current = entry.path;
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
  }, [entry, requestPreview, loadVideo, auth?.user?.id, auth?.session?.access_token]);
  const previewMessage = allowDownload ? state.message : state.message?.replace(/(?:You can still download|Download the original)[^.]*\.?/gi, '').trim();
  const loading = state.status === 'loading' || state.status === 'generating';
  return createPortal(<TaskModal ref={playerRef} aria-label="File preview" className="fixed inset-0 z-90 flex items-center justify-center bg-slate-950/80 p-2 sm:p-6">
    <section ref={surfaceRef} className="video-fullscreen-surface flex h-[90dvh] max-h-full w-full max-w-6xl min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-3 py-2 sm:px-5 sm:py-3">
        <FileTypeIcon entry={entry} size={24} />
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-slate-800" title={entry.name}>{entry.name}</h2><p className="text-xs text-slate-500">Read-only preview · Original file unchanged</p></div>
        {allowDownload && <button onClick={onDownload} aria-label="Download original file" title="Download original file" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><Download size={19} /></button>}
        <button onClick={completion.close} aria-label="Close preview" title="Close preview" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={20} /></button>
      </header>
      <div className="video-playback-area relative flex min-h-0 flex-1 flex-col overflow-auto bg-slate-100 p-2 sm:p-4" aria-busy={loading}>
        {loading ? <div role="status" className="m-auto px-4 text-center"><LoaderCircle size={32} className="mx-auto mb-3 animate-spin text-blue-600" /><p className="font-semibold text-slate-800">{state.status === 'generating' ? 'Generating preview…' : 'Loading preview…'}</p><p className="mt-2 text-sm text-slate-500">{state.message || 'You can close this window while the preview is prepared.'}</p></div>
          : state.status !== 'ready' ? <div role="status" className="m-auto max-w-md px-4 text-center"><FileText size={44} className="mx-auto mb-3 text-slate-400" /><h3 className="font-semibold text-slate-800">{state.status === 'unsupported' ? 'Preview is not available for this file type' : 'Preview could not be generated'}</h3><p className="mt-2 wrap-break-word text-sm text-slate-600">{previewMessage || (allowDownload ? `You can still download the original file (${(entry.size / 1048576).toFixed(2)} MB).` : 'A preview is currently unavailable.')}</p>{allowDownload && <button onClick={onDownload} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">Download original file</button>}</div>
          : state.kind === 'pdf' && state.url ? <Suspense fallback={<p role="status" className="m-auto text-sm text-slate-500">Loading PDF viewer…</p>}><PdfFilePreview url={state.url} name={entry.name} allowDownload={allowDownload} /></Suspense>
          : state.kind === 'image' ? <img src={state.url} alt={entry.name} onError={() => setState({ status: 'failed', message: 'This image could not be decoded. You can still download the original file.' })} className="m-auto max-h-full max-w-full object-contain" />
          : state.kind === 'video' ? <video ref={videoRef} src={state.url} controls playsInline controlsList={allowDownload ? 'nofullscreen' : 'nodownload nofullscreen'} onEnded={completion.onEnded} onSeeking={completion.onSeeking} onPlaying={completion.onPlaying} onError={() => setState({ status: 'failed', message: 'This video cannot be played by your browser. You can still download the original file.' })} className="managed-video m-auto max-h-full max-w-full object-contain" />
          : state.kind === 'csv' && state.csv ? <><p className="mb-2 shrink-0 text-xs text-slate-500">{state.csv.truncated ? 'Showing up to 200 rows, 50 columns and 2,000 characters per cell.' + (allowDownload ? ' Download the original for all data.' : '') : `${state.csv.rows.length} rows · Read-only table`}</p><div className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white"><table className="w-full border-collapse text-left text-sm text-slate-800"><tbody>{state.csv.rows.map((row, index) => <tr key={index} className={index % 2 ? 'bg-slate-50' : ''}>{row.map((cell, column) => <td key={column} className="min-w-[100px] max-w-xs whitespace-pre-wrap wrap-break-word border border-slate-100 px-3 py-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div></>
          : <pre className="min-h-0 overflow-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-white p-4 font-mono text-sm text-slate-800">{state.text || '(Empty file)'}</pre>}
      </div>
      {state.status === 'ready' && state.kind === 'video' && <VideoPresentationControls videoRef={videoRef} surfaceRef={surfaceRef} source={state.url} />}
      {state.status === 'ready' && state.kind === 'pdf' && <p className="shrink-0 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Scroll through pages or use the PDF controls.{filePreviewKind(entry) === 'office' ? ' Office previews show up to 200 pages.' : ''}</p>}
    </section>
  </TaskModal>, document.body);
}
