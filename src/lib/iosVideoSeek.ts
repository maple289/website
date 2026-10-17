export function isIOSTouchVideo(video: HTMLVideoElement) {
  const view = video.ownerDocument.defaultView, nav = view?.navigator;
  return !!view?.matchMedia('(pointer: coarse)').matches && !!nav &&
    (/iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1));
}

// Native controls have an opaque shadow tree. iOS can expose a pointer stream
// without the TouchEvents used by the application's existing idle handling.
// Observe that stream without capturing its pointer or cancelling its defaults.
export function protectIOSVideoSeek(video: HTMLVideoElement, surface: HTMLElement, idle: {
  start: () => void; moved: () => void; end: () => void;
}) {
  const view = video.ownerDocument.defaultView;
  if (!view || !surface.classList.contains('video-player-surface') || !isIOSTouchVideo(video)) {
    return { get held() { return false; }, enabled: false, dispose() {} };
  }
  const pointers = new Map<number, { x: number; y: number }>();
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || (event.target !== video && !pointers.size)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    idle.start();
  };
  const move = (event: PointerEvent) => {
    const start = pointers.get(event.pointerId);
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) idle.moved();
  };
  const up = (event: PointerEvent) => {
    if (pointers.delete(event.pointerId) && !pointers.size) idle.end();
  };
  const reset = () => { if (pointers.size) { pointers.clear(); idle.end(); } };
  const touchEnded = (event: TouchEvent) => { if (!event.touches.length) reset(); };
  const visibility = () => { if (video.ownerDocument.hidden) reset(); };
  video.classList.add('ios-video-seek');
  surface.addEventListener('pointerdown', down, true);
  // A native slider owns capture; never take it away. Observe release even if
  // the finger leaves the video, and clear cancellation/background state too.
  view.addEventListener('pointermove', move, true);
  view.addEventListener('pointerup', up, true);
  view.addEventListener('pointercancel', up, true);
  view.addEventListener('touchend', touchEnded, { capture: true, passive: true });
  view.addEventListener('touchcancel', reset, true);
  view.addEventListener('blur', reset);
  video.ownerDocument.addEventListener('visibilitychange', visibility);
  return {
    get held() { return pointers.size > 0; }, enabled: true,
    dispose() {
      pointers.clear(); video.classList.remove('ios-video-seek');
      surface.removeEventListener('pointerdown', down, true);
      view.removeEventListener('pointermove', move, true);
      view.removeEventListener('pointerup', up, true);
      view.removeEventListener('pointercancel', up, true);
      view.removeEventListener('touchend', touchEnded, true);
      view.removeEventListener('touchcancel', reset, true);
      view.removeEventListener('blur', reset);
      video.ownerDocument.removeEventListener('visibilitychange', visibility);
    },
  };
}
