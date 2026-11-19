import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PdfPreviewUnavailable } from './PdfPreviewBoundary';
import { logPdfFailure } from '@/lib/pdfDiagnostics';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import './PdfFilePreview.css';

GlobalWorkerOptions.workerSrc = pdfWorker;
const clampZoom = (value: number) => Math.max(0.25, Math.min(3, value));

export function PdfFilePreview({ data, name, allowDownload = true, onDownload, onClose }: {
  data: Blob; name: string; allowDownload?: boolean; onDownload?: () => void; onClose?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null), pages = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const [page, setPage] = useState(1), [count, setCount] = useState(0), [zoom, setZoom] = useState(100), [pageInput, setPageInput] = useState('1');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const host = container.current, pageHost = pages.current;
    if (!host || !pageHost) return;
    let active = true, failed = false, frame = 0;
    let viewer: PDFViewer | undefined, resize: ResizeObserver | undefined;
    let task: ReturnType<typeof getDocument> | undefined;
    let pinch: { distance: number; scale: number } | undefined;
    setLoading(true); setError(''); setPage(1); setPageInput('1'); setCount(0); setZoom(100);
    const eventBus = new EventBus(), linkService = new PDFLinkService({ eventBus });
    const fail = (cause: unknown, stage: string) => {
      if (!active || failed) return;
      failed = true; clearTimeout(timeout); setLoading(false);
      logPdfFailure(stage, cause);
      setError(cause instanceof Error && cause.name === 'PasswordException'
        ? 'This PDF requires a password. Open the downloaded original in a PDF reader.' : 'This PDF could not be displayed.');
      void task?.destroy().catch(() => {});
    };
    const timeout = window.setTimeout(() => fail(new Error('PDF rendering timeout'), 'timeout'), 45000);
    const initialized = () => {
      if (!active || failed || !viewer) return;
      viewer.currentScaleValue = 'page-width'; setCount(viewer.pagesCount);
    };
    const changed = ({ pageNumber }: { pageNumber: number }) => {
      if (active && !failed) { setPage(pageNumber); setPageInput(String(pageNumber)); }
    };
    const scaled = ({ scale }: { scale: number }) => { if (active && !failed) setZoom(Math.round(scale * 100)); };
    const rendered = ({ error: cause }: { error?: unknown }) => {
      if (!active || failed) return;
      if (cause) { fail(cause, 'page_render'); return; }
      clearTimeout(timeout); setLoading(false);
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !viewer?.pagesCount) { pinch = undefined; return; }
      event.preventDefault();
      const [a, b] = Array.from(event.touches);
      pinch = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale: viewer.currentScale };
    };
    const touchMove = (event: TouchEvent) => {
      if (!pinch || !viewer || event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = Array.from(event.touches), start = pinch;
      const target = clampZoom(start.scale * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / Math.max(start.distance, 1));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (active && !failed && viewer) viewer.updateScale({ scaleFactor: target / viewer.currentScale, origin: [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2], drawingDelay: 120 });
      });
    };
    const touchEnd = () => { pinch = undefined; };
    try {
      viewer = new PDFViewer({ container: host, viewer: pageHost, eventBus, linkService,
        textLayerMode: 1, annotationMode: 0, annotationEditorMode: -1, enableAutoLinking: false,
        maxCanvasPixels: 2097152, maxCanvasDim: 4096, enableDetailCanvas: true, removePageBorders: true });
      viewerRef.current = viewer; linkService.setViewer(viewer);
      eventBus.on('pagesinit', initialized); eventBus.on('pagechanging', changed);
      eventBus.on('scalechanging', scaled); eventBus.on('pagerendered', rendered);
      const base = `${import.meta.env.BASE_URL}pdfjs/`;
      // No PDF scripting, XFA, editable annotations or external link actions.
      // Bytes have already passed the caller's authorized, bounded fetch. A Blob
      // URL would require a second fetch, blocked by production connect-src CSP.
      const load = async () => {
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (!active || failed) return;
        task = getDocument({ data: bytes, enableXfa: false, useSystemFonts: true,
          cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`,
          canvasMaxAreaInBytes: 16 * 1048576 });
        const document = await task.promise;
        if (!active || failed) return;
        viewer!.setDocument(document); linkService.setDocument(document);
      };
      void load().catch(cause => fail(cause, 'document_load'));
      resize = new ResizeObserver(() => {
        if (active && !failed && viewer?.pagesCount && viewer.currentScaleValue === 'page-width') viewer.currentScaleValue = 'page-width';
      });
      resize.observe(host);
      host.addEventListener('touchstart', touchStart, { passive: false });
      host.addEventListener('touchmove', touchMove, { passive: false });
      host.addEventListener('touchend', touchEnd); host.addEventListener('touchcancel', touchEnd);
    } catch (cause) { fail(cause, 'viewer_init'); }
    return () => {
      active = false; clearTimeout(timeout); cancelAnimationFrame(frame); resize?.disconnect(); viewerRef.current = null;
      host.removeEventListener('touchstart', touchStart); host.removeEventListener('touchmove', touchMove);
      host.removeEventListener('touchend', touchEnd); host.removeEventListener('touchcancel', touchEnd);
      eventBus.off('pagesinit', initialized); eventBus.off('pagechanging', changed);
      eventBus.off('scalechanging', scaled); eventBus.off('pagerendered', rendered);
      try { viewer?.setDocument(null as unknown as PDFDocumentProxy); linkService.setDocument(null); }
      catch { /* Source destruction and explicit Close must still complete. */ }
      void task?.destroy().catch(() => {});
    };
  }, [data]);
  const go = (next: number) => {
    const viewer = viewerRef.current;
    if (viewer && count && Number.isFinite(next)) viewer.currentPageNumber = Math.min(count, Math.max(1, Math.trunc(next)));
  };
  const scale = (factor: number) => {
    const viewer = viewerRef.current;
    if (viewer?.pagesCount) viewer.updateScale({ scaleFactor: clampZoom(viewer.currentScale * factor) / viewer.currentScale });
  };
  const button = 'flex h-10 min-w-10 items-center justify-center rounded-lg px-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40';
  return <div className="fp-pdf flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-white">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-slate-200 px-2 py-1" aria-label="PDF controls">
      <div className="flex items-center gap-1">
        <button aria-label="Previous PDF page" onClick={() => go(page - 1)} disabled={page <= 1 || !count || !!error} className={button}><ChevronLeft size={18} /></button>
        <span aria-live="polite" className="text-xs font-medium text-slate-600">Page {page} / {count || '…'}</span>
        <input aria-label="Go to PDF page" type="number" inputMode="numeric" min={1} max={count || 1} value={pageInput} disabled={!count || !!error}
          onChange={event => setPageInput(event.target.value)} onBlur={() => { go(Number(pageInput)); setPageInput(String(viewerRef.current?.currentPageNumber || page)); }}
          onKeyDown={event => { if (event.key === 'Enter') { go(Number(pageInput)); event.currentTarget.blur(); } }}
          className="h-9 w-14 rounded-lg border border-slate-200 bg-white px-1 text-center text-xs text-slate-700" />
        <button aria-label="Next PDF page" onClick={() => go(page + 1)} disabled={page >= count || !count || !!error} className={button}><ChevronRight size={18} /></button>
      </div>
      <div className="flex items-center gap-1">
        <button aria-label="Zoom out PDF" onClick={() => scale(1 / 1.2)} disabled={!count || zoom <= 25 || !!error} className={button}><Minus size={16} /></button>
        <span aria-label="PDF zoom" className="min-w-9 text-center text-xs text-slate-600">{zoom}%</span>
        <button aria-label="Fit PDF to width" onClick={() => { if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-width'; }} disabled={!count || !!error} className={`${button} text-xs`}>Fit width</button>
        <button aria-label="Zoom in PDF" onClick={() => scale(1.2)} disabled={!count || zoom >= 300 || !!error} className={button}><Plus size={16} /></button>
      </div>
    </div>
    <div className="relative min-h-0 flex-1">
      <div ref={container} tabIndex={0} aria-label={`PDF pages for ${name}`} className="fp-pdf-scroll absolute inset-0 overflow-auto bg-slate-200/70"><div ref={pages} className="pdfViewer" /></div>
      {loading && <div role="status" className="absolute inset-0 flex items-center justify-center bg-white/90"><LoaderCircle size={28} className="mr-2 animate-spin text-blue-600" />Rendering PDF…</div>}
      {error && <div className="absolute inset-0 flex overflow-auto bg-white"><PdfPreviewUnavailable allowDownload={allowDownload} onDownload={onDownload} onClose={onClose} message={error} /></div>}
    </div>
  </div>;
}
