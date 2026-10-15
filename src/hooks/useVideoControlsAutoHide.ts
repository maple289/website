import { useEffect, type RefObject } from 'react';

export function useVideoControlsAutoHide(videoRef: RefObject<HTMLVideoElement>, surfaceRef: RefObject<HTMLElement>, controlsRef: RefObject<HTMLDivElement>, source: string | null | undefined, fullscreen: boolean, error: string) {
  useEffect(() => {
    const video = videoRef.current, surface = surfaceRef.current, controls = controlsRef.current;
    if (!video || !surface || !controls) return;
    const view = video.ownerDocument.defaultView;
    if (!view) return;
    const coarse = view.matchMedia('(pointer: coarse)');
    let timer: number | undefined, held = false, keyboard = false, revealTouch = false;
    const clear = () => { view.clearTimeout(timer); timer = undefined; };
    const show = () => {
      clear();
      controls.classList.remove('video-controls-hidden');
      controls.removeAttribute('inert');
      controls.removeAttribute('aria-hidden');
    };
    const canHide = () => fullscreen && !error && coarse.matches && surface.classList.contains('video-player-surface') &&
      !video.paused && !video.ended && !video.seeking && !video.error && video.readyState >= video.HAVE_FUTURE_DATA && !held &&
      !(keyboard && controls.contains(video.ownerDocument.activeElement));
    const reconcile = () => {
      if (!canHide()) { show(); return; }
      // Media progress must neither reveal hidden controls nor keep restarting
      // an existing idle deadline. Read current readiness instead of latching
      // a download-stall event until a future "playing" event happens to arrive.
      if (timer !== undefined || controls.classList.contains('video-controls-hidden')) return;
      timer = view.setTimeout(() => {
        timer = undefined;
        if (!canHide()) return;
        // A touch-clicked Exit button may retain focus. Move it inside the same
        // viewer before hiding; keyboard focus always keeps controls available.
        if (controls.contains(video.ownerDocument.activeElement)) surface.focus({ preventScroll: true });
        controls.classList.add('video-controls-hidden');
        controls.setAttribute('inert', '');
        controls.setAttribute('aria-hidden', 'true');
      }, 2000);
    };
    const schedule = () => { show(); reconcile(); };
    const touchStart = (event: TouchEvent) => {
      revealTouch = controls.classList.contains('video-controls-hidden') && event.target instanceof Node && !controls.contains(event.target);
      keyboard = false; held = true; show();
    };
    const touchEnd = (event: TouchEvent) => { held = event.touches.length > 0; schedule(); };
    const touchCancel = () => { revealTouch = false; held = false; schedule(); };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') { revealTouch = false; keyboard = false; held = true; show(); }
    };
    const pointerUp = (event: PointerEvent) => { if (event.pointerType !== 'touch') touchCancel(); };
    const keyDown = (event: KeyboardEvent) => {
      const modal = surface.closest('[data-task-modal]');
      if (!(event.target instanceof Node) || !modal?.contains(event.target)) return;
      revealTouch = false; keyboard = true; schedule();
    };
    const guardRevealClick = (event: MouseEvent) => {
      // A browser can retarget the first touch's synthetic click to a button
      // that has just appeared under the finger. That touch only reveals it.
      if (!revealTouch || event.detail === 0) return;
      revealTouch = false; event.preventDefault(); event.stopImmediatePropagation();
    };
    const focused = () => { if (keyboard) schedule(); };
    const events = ['playing', 'play', 'pause', 'ended', 'seeking', 'seeked', 'waiting', 'stalled', 'error', 'canplay', 'progress', 'timeupdate'];
    for (const name of events) video.addEventListener(name, reconcile);
    surface.addEventListener('touchstart', touchStart, { capture: true, passive: true });
    surface.addEventListener('touchend', touchEnd, { capture: true, passive: true });
    surface.addEventListener('touchcancel', touchCancel, { capture: true, passive: true });
    surface.addEventListener('pointerdown', pointerDown, true);
    surface.addEventListener('pointerup', pointerUp, true);
    surface.addEventListener('pointercancel', pointerUp, true);
    surface.addEventListener('focusin', focused);
    controls.addEventListener('click', guardRevealClick, true);
    view.addEventListener('keydown', keyDown, true);
    coarse.addEventListener('change', schedule);
    schedule();
    return () => {
      show();
      for (const name of events) video.removeEventListener(name, reconcile);
      surface.removeEventListener('touchstart', touchStart, true);
      surface.removeEventListener('touchend', touchEnd, true);
      surface.removeEventListener('touchcancel', touchCancel, true);
      surface.removeEventListener('pointerdown', pointerDown, true);
      surface.removeEventListener('pointerup', pointerUp, true);
      surface.removeEventListener('pointercancel', pointerUp, true);
      surface.removeEventListener('focusin', focused);
      controls.removeEventListener('click', guardRevealClick, true);
      view.removeEventListener('keydown', keyDown, true);
      coarse.removeEventListener('change', schedule);
    };
  }, [videoRef, surfaceRef, controlsRef, source, fullscreen, error]);
}
