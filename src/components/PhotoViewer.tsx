import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Photo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';
import './PhotoViewer.css';

type PhotoViewerProps = { photos: Photo[]; startIndex: number; onClose: () => void };
const controls = 'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="menu"], [role="combobox"]';

function ViewerPhoto({ photo, current }: { photo: Photo; current: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo.storage_path]);
  const fallback = <div className="pv-loading">Unable to load photo.</div>;
  return failed ? fallback : <StorageImage storagePath={photo.storage_path} alt={current ? photo.file_name : ''}
    draggable={false} className="pv-photo" onError={() => setFailed(true)} fallback={fallback} />;
}

export function PhotoViewer({ photos, startIndex, onClose }: PhotoViewerProps) {
  const [photoId, setPhotoId] = useState(photos[startIndex]?.id);
  const found = photos.findIndex((item) => item.id === photoId);
  const index = found >= 0 ? found : Math.max(0, Math.min(startIndex, photos.length - 1));
  const photo = photos[index];
  const hasMultiple = photos.length > 1;
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const busy = useRef(false);
  const timer = useRef<number>();
  const gesture = useRef<{ x: number; y: number; dx: number; horizontal: boolean; cancelled: boolean } | null>(null);
  const suppressClick = useRef(false);

  const navigate = useCallback((direction: number) => {
    if (busy.current || photos.length < 2) return;
    const next = photos[(index + direction + photos.length) % photos.length];
    busy.current = true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setAnimating(!reduceMotion);
    setOffset(-direction * (stage.current?.clientWidth ?? 0));
    timer.current = window.setTimeout(() => {
      setPhotoId(next.id); setAnimating(false); setOffset(0); busy.current = false;
    }, reduceMotion ? 0 : 190);
  }, [index, photos]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
    root.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(timer.current);
      document.body.style.overflow = bodyOverflow; document.documentElement.style.overflow = htmlOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!root.current?.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'Tab') {
        const buttons = Array.from(root.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || target?.closest(controls) || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const space = event.code === 'Space' || event.key === ' ';
      if ((!event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) || space) {
        event.preventDefault();
        if (!event.repeat) navigate(event.key === 'ArrowLeft' || (space && event.altKey) ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, onClose]);

  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let lastEvent = 0, lastMove = -Infinity, total = 0, consumed = false;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); // Includes trackpad pinch: never zoom/scroll the page behind the viewer.
      const target = event.target instanceof Element ? event.target : null;
      if (event.ctrlKey || target?.closest(controls) || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const now = performance.now();
      if (now - lastEvent > 180) { consumed = false; total = 0; }
      lastEvent = now;
      if (consumed || now - lastMove < 450) return;
      const amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      if (Math.sign(amount) !== Math.sign(total)) total = 0;
      total += amount;
      if (Math.abs(total) < 35) return;
      consumed = true; lastMove = now;
      navigateRef.current(total > 0 ? 1 : -1);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const start = (event: TouchEvent) => {
      suppressClick.current = false;
      if (busy.current || event.touches.length !== 1 || (event.target instanceof Element && event.target.closest(controls))) { gesture.current = null; return; }
      const touch = event.touches[0];
      gesture.current = { x: touch.clientX, y: touch.clientY, dx: 0, horizontal: false, cancelled: false };
    };
    const move = (event: TouchEvent) => {
      const swipe = gesture.current;
      if (!swipe) return;
      if (event.touches.length !== 1) { swipe.cancelled = true; setOffset(0); return; }
      if (swipe.cancelled) return;
      const dx = event.touches[0].clientX - swipe.x, dy = event.touches[0].clientY - swipe.y;
      if (!swipe.horizontal && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe.cancelled = true; return; }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) swipe.horizontal = true;
      if (!swipe.horizontal) return;
      event.preventDefault(); suppressClick.current = true; swipe.dx = dx;
      setOffset(Math.max(-element.clientWidth, Math.min(element.clientWidth, dx)));
    };
    const end = () => {
      const swipe = gesture.current; gesture.current = null;
      if (!swipe || swipe.cancelled || !swipe.horizontal) { setOffset(0); return; }
      const threshold = Math.max(45, Math.min(100, element.clientWidth * .15));
      if (Math.abs(swipe.dx) >= threshold && hasMultiple) navigateRef.current(swipe.dx < 0 ? 1 : -1);
      else { setAnimating(true); setOffset(0); timer.current = window.setTimeout(() => setAnimating(false), 190); }
    };
    const cancel = () => { gesture.current = null; setOffset(0); };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    return () => { element.removeEventListener('touchstart', start); element.removeEventListener('touchmove', move); element.removeEventListener('touchend', end); element.removeEventListener('touchcancel', cancel); };
  }, [hasMultiple]);

  if (!photo) return null;
  const slides = hasMultiple ? [-1, 0, 1] : [0];
  return <div ref={root} tabIndex={-1} className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo viewer"
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button aria-label="Close" onClick={onClose} className="pv-close pv-control"><X size={22} /></button>
    {hasMultiple && <>
      <button aria-label="Previous photo" onClick={() => navigate(-1)} className="pv-prev pv-control"><ChevronLeft size={26} /></button>
      <button aria-label="Next photo" onClick={() => navigate(1)} className="pv-next pv-control"><ChevronRight size={26} /></button>
    </>}
    <div ref={stage} className="pv-stage" onDragStart={(event) => event.preventDefault()}
      onClick={(event) => { event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return; } root.current?.focus({ preventScroll: true }); }}>
      {slides.map((position) => {
        const item = photos[(index + position + photos.length) % photos.length];
        return <div key={photos.length === 2 ? `${position}:${item.id}` : item.id} className="pv-slide" aria-hidden={position !== 0}
          style={{ transform: `translateX(calc(${position * 100}% + ${offset}px))`, transition: animating ? 'transform 180ms ease-out' : 'none' }}>
          <ViewerPhoto photo={item} current={position === 0} />
        </div>;
      })}
    </div>
    <div className="pv-info" aria-live="polite" aria-atomic="true"><p title={photo.file_name}>{photo.file_name}</p>{hasMultiple && <span>{index + 1} of {photos.length}</span>}</div>
  </div>;
}
