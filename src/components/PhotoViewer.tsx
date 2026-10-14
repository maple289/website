import { useModalLayer } from '@/hooks/useModalLayer';
import { MediaReactions } from './MediaReactions';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuthContext } from '@/context/AuthContext';
import { ChevronLeft, ChevronRight, Maximize, Minimize, X } from 'lucide-react';
import type { Photo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';
import './PhotoViewer.css';
import { analyticsRequestId, recordMediaView } from '@/lib/analytics';
import { usePhotoFullscreen } from '@/hooks/usePhotoFullscreen';
import { listenForMediaDoubleTap } from '@/lib/mediaDoubleTap';

type PhotoViewerProps = { photos: Photo[]; startIndex: number; onClose: () => void; onPhotoChange?: (id: string) => void };
const controls = 'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="menu"], [role="combobox"], [data-reaction-control]';

function ViewerPhoto({ photo, current }: { photo: Photo; current: boolean }) {
  const auth = useContext(AuthContext);
  const [failed, setFailed] = useState(false);
  const [usePreview, setUsePreview] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setFailed(false); setUsePreview(false); }, [photo.storage_path, photo.preview_path, photo.visibility, auth?.user?.id, auth?.session?.access_token]);
  const fallback = <div className="pv-loading"><p>Unable to load photo.</p>{current && <button className="pv-retry" onClick={() => { setFailed(false); setUsePreview(false); setAttempt(value => value + 1); }}>Retry</button>}</div>;
  return failed ? fallback : <StorageImage key={attempt} publicAccess={photo.visibility === 'public'} storagePath={usePreview ? photo.preview_path : photo.storage_path} alt={current ? photo.file_name : ''}
    draggable={false} className="pv-photo" onError={() => {
      // HEIC/TIFF and other valid originals may not have a browser decoder.
      if (!usePreview && photo.preview_path) setUsePreview(true);
      else setFailed(true);
    }} fallback={fallback} loadingFallback={<div className="pv-loading" role={current ? 'status' : undefined}>Loading photo…</div>} />;
}

export function PhotoViewer({ photos, startIndex, onClose, onPhotoChange }: PhotoViewerProps) {
  const [photoId, setPhotoId] = useState(photos[startIndex]?.id);
  const found = photos.findIndex((item) => item.id === photoId);
  const index = found >= 0 ? found : Math.max(0, Math.min(startIndex, photos.length - 1));
  const photo = photos[index];
  const hasMultiple = photos.length > 1;
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useModalLayer(root, !!photo);
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const { fullscreen, toggleFullscreen } = usePhotoFullscreen(root);
  const fullscreenAction = useRef(toggleFullscreen); fullscreenAction.current = toggleFullscreen;
  const busy = useRef(false);
  const timer = useRef<number>();
  const gesture = useRef<{ x: number; y: number; dx: number; horizontal: boolean; cancelled: boolean } | null>(null);
  const suppressClick = useRef(false);
  const viewedPhoto = useRef<string>();

  useEffect(() => {
    if (photo?.id && viewedPhoto.current !== photo.id) {
      viewedPhoto.current = photo.id;
      recordMediaView('photo', photo.id, analyticsRequestId());
    }
  }, [photo?.id]);

  const navigate = useCallback((direction: number) => {
    if (busy.current || photos.length < 2) return;
    const next = photos[(index + direction + photos.length) % photos.length];
    busy.current = true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setAnimating(!reduceMotion);
    setOffset(-direction * (stage.current?.clientWidth ?? 0));
    timer.current = window.setTimeout(() => {
      setPhotoId(next.id); onPhotoChange?.(next.id); setAnimating(false); setOffset(0); busy.current = false;
    }, reduceMotion ? 0 : 190);
  }, [index, photos, onPhotoChange]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!root.current?.contains(document.activeElement)) return;
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
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-reaction-control]')) return;
      event.preventDefault(); // Includes trackpad pinch: never zoom/scroll the page behind the viewer.
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
    const removeDoubleTap = listenForMediaDoubleTap(root.current ?? element, () => {
      suppressClick.current = true;
      fullscreenAction.current();
    }, event => !busy.current && event.target instanceof Element && event.target.matches('.pv-slide:not([aria-hidden="true"]) .pv-photo'));
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
    element.addEventListener('touchend', end, { passive: false });
    element.addEventListener('touchcancel', cancel);
    return () => { removeDoubleTap(); gesture.current = null; element.removeEventListener('touchstart', start); element.removeEventListener('touchmove', move); element.removeEventListener('touchend', end); element.removeEventListener('touchcancel', cancel); };
  }, [hasMultiple, photo?.id]);

  if (!photo) return null;
  const slides = hasMultiple ? [-1, 0, 1] : [0];
  return createPortal(<div ref={root} tabIndex={-1} className={`photo-viewer${fullscreen ? ' pv-fullscreen' : ''}`} onClick={(event) => event.stopPropagation()} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }} role="dialog" data-focus-viewer data-task-modal aria-modal="true" aria-label="Photo viewer">
    <button aria-label="Close" onClick={onClose} className="pv-close pv-control"><X size={22} /></button>
    <button aria-label={fullscreen ? 'Exit photo fullscreen' : 'Enter photo fullscreen'} onClick={toggleFullscreen} className="pv-fullscreen-toggle pv-control">
      {fullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
    </button>
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
    <div className="pv-reactions" data-reaction-control><MediaReactions mediaType="photo" mediaId={photo.id} mediaName={photo.file_name} /></div>
  </div>, document.body);
}
