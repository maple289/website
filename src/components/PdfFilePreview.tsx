import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import './PdfFilePreview.css';

GlobalWorkerOptions.workerSrc = pdfWorker;

export function PdfFilePreview({ url, name }: { url: string; name: string }) {
  const container = useRef<HTMLDivElement>(null), pages = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const [page, setPage] = useState(1), [count, setCount] = useState(0), [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    if (!container.current || !pages.current) return;
    let active = true;
    setLoading(true); setError(''); setPage(1); setCount(0);
    const eventBus = new EventBus(), linkService = new PDFLinkService({ eventBus });
    const viewer = new PDFViewer({ container: container.current, viewer: pages.current, eventBus, linkService,
      textLayerMode: 1, annotationMode: 0, annotationEditorMode: -1,
      maxCanvasPixels: 2097152, maxCanvasDim: 4096, removePageBorders: true });
    viewerRef.current = viewer; linkService.setViewer(viewer);
    const initialized = () => { if (active) { viewer.currentScaleValue = 'page-width'; setCount(viewer.pagesCount); } };
    const changed = ({ pageNumber }: { pageNumber: number }) => { if (active) setPage(pageNumber); };
    const scaled = ({ scale }: { scale: number }) => { if (active) setZoom(Math.round(scale * 100)); };
    const rendered = ({ error: renderError }: { error?: unknown }) => {
      if (!active) return;
      setLoading(false);
      if (renderError) setError('This PDF page could not be rendered. You can still download the original file.');
    };
    eventBus.on('pagesinit', initialized); eventBus.on('pagechanging', changed);
    eventBus.on('scalechanging', scaled); eventBus.on('pagerendered', rendered);
    const base = `${import.meta.env.BASE_URL}pdfjs/`;
    // No document scripting, XFA, editable annotations or external URL fetching.
    const task = getDocument({ url, enableXfa: false, useSystemFonts: true,
      cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`,
      canvasMaxAreaInBytes: 16 * 1048576, stopAtErrors: true });
    void task.promise.then(document => {
      if (!active) return;
      viewer.setDocument(document); linkService.setDocument(document);
    }).catch(cause => {
      if (!active) return;
      setLoading(false);
      setError(cause?.name === 'PasswordException' ? 'Password-protected PDFs cannot be previewed. You can still download the original file.' : 'This PDF could not be rendered. You can still download the original file.');
    });
    const resize = new ResizeObserver(() => { if (active && viewer.pagesCount && viewer.currentScaleValue === 'page-width') viewer.currentScaleValue = 'page-width'; });
    resize.observe(container.current);
    return () => {
      active = false; resize.disconnect(); viewerRef.current = null;
      eventBus.off('pagesinit', initialized); eventBus.off('pagechanging', changed);
      eventBus.off('scalechanging', scaled); eventBus.off('pagerendered', rendered);
      // PDF.js accepts null to cancel page rendering and release its canvas cache.
      viewer.setDocument(null as unknown as PDFDocumentProxy); linkService.setDocument(null);
      void task.destroy().catch(() => {});
    };
  }, [url]);
  const go = (delta: number) => { const viewer = viewerRef.current; if (viewer) viewer.currentPageNumber = Math.min(count, Math.max(1, page + delta)); };
  const scale = (factor: number) => { const viewer = viewerRef.current; if (viewer) viewer.currentScale = Math.max(0.25, Math.min(3, viewer.currentScale * factor)); };
  const button = 'flex h-10 min-w-10 items-center justify-center rounded-lg px-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40';
  return <div className="fp-pdf flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-white">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-slate-200 px-2 py-1" aria-label="PDF controls">
      <div className="flex items-center gap-1"><button aria-label="Previous PDF page" onClick={() => go(-1)} disabled={page <= 1 || !count} className={button}><ChevronLeft size={18} /></button><span aria-live="polite" className="min-w-16 text-center text-xs font-medium text-slate-600">Page {page} / {count || '…'}</span><button aria-label="Next PDF page" onClick={() => go(1)} disabled={page >= count || !count} className={button}><ChevronRight size={18} /></button></div>
      <div className="flex items-center gap-1"><button aria-label="Zoom out PDF" onClick={() => scale(1 / 1.2)} disabled={!count || zoom <= 25} className={button}><Minus size={16} /></button><button aria-label="Fit PDF to width" onClick={() => { if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-width'; }} disabled={!count} className={`${button} text-xs`}>Fit width</button><button aria-label="Zoom in PDF" onClick={() => scale(1.2)} disabled={!count || zoom >= 300} className={button}><Plus size={16} /></button></div>
    </div>
    <div className="relative min-h-0 flex-1">
      <div ref={container} tabIndex={0} aria-label={`PDF pages for ${name}`} className="fp-pdf-scroll absolute inset-0 overflow-auto bg-slate-200/70"><div ref={pages} className="pdfViewer" /></div>
      {loading && <div role="status" className="absolute inset-0 flex items-center justify-center bg-white/90"><LoaderCircle size={28} className="mr-2 animate-spin text-blue-600" />Rendering PDF…</div>}
      {error && <div role="status" className="absolute inset-0 flex items-center justify-center bg-white p-6 text-center text-sm text-slate-600">{error}</div>}
    </div>
  </div>;
}
