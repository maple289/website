import { useEffect, type RefObject } from 'react';
import type { FullscreenDocument } from '@/lib/videoFullscreen';
import { protectIOSVideoSeek } from '@/lib/iosVideoSeek';

export function useVideoControlsAutoHide(videoRef: RefObject<HTMLVideoElement>, surfaceRef: RefObject<HTMLElement>, controlsRef: RefObject<HTMLDivElement>, source: string | null | undefined, fullscreen: boolean, error: string) {
  useEffect(() => {
    const video = videoRef.current, surface = surfaceRef.current, controls = controlsRef.current;
    if (!video || !surface || !controls) return;
    const doc = video.ownerDocument as FullscreenDocument, view = doc.defaultView;
    if (!view) return;
    const coarse = view.matchMedia('(pointer: coarse)');
    let timer: number | undefined, held = false, keyboard = false, revealTouch = false, nativeControlsHidden = false;
    let progressTimer: number | undefined, lastTime = video.currentTime, progressedAt = -Infinity;
    const clear = () => { view.clearTimeout(timer); timer = undefined; };
    const resetProgress = () => {
      view.clearTimeout(progressTimer); progressTimer = undefined;
      lastTime = video.currentTime; progressedAt = -Infinity;
    };
    const restoreNativeControls = () => {
      if (nativeControlsHidden) { nativeControlsHidden = false; video.controls = true; }
    };
    const show = () => {
      clear();
      restoreNativeControls();
      controls.classList.remove('video-controls-hidden');
      controls.removeAttribute('inert');
      controls.removeAttribute('aria-hidden');
    };
    const mobileFullscreen = () => fullscreen && !error && coarse.matches && surface.classList.contains('video-player-surface');
    const running = () => !video.paused && !video.ended && !video.seeking && !video.error && video.readyState >= video.HAVE_CURRENT_DATA;
    const needsProgress = () => mobileFullscreen() && running() && video.readyState < video.HAVE_FUTURE_DATA;
    const canHide = () => mobileFullscreen() && running() &&
      (video.readyState >= video.HAVE_FUTURE_DATA || view.performance.now() - progressedAt < 1000) && !held && !iosSeek.held &&
      !(keyboard && (controls.contains(doc.activeElement) || doc.activeElement === video));
    const sampleProgress = () => {
      progressTimer = undefined;
      if (needsProgress()) {
        const time = video.currentTime;
        if (Math.abs(time - lastTime) > .001) progressedAt = view.performance.now();
        lastTime = time;
      }
      reconcile();
    };
    const reconcile = () => {
      // WebKit can stay at HAVE_CURRENT_DATA after a seek even as playback
      // advances. Observe the clock only in that mobile fullscreen state.
      // Sampling also expires the evidence if progress stops without an event.
      if (needsProgress()) {
        if (progressTimer === undefined) progressTimer = view.setTimeout(sampleProgress, 250);
      } else resetProgress();
      if (!canHide()) { show(); return; }
      // Media progress must neither reveal hidden controls nor keep restarting
      // an existing idle deadline. Read current readiness/progress instead of latching
      // a download-stall event until a future "playing" event happens to arrive.
      if (timer !== undefined || controls.classList.contains('video-controls-hidden')) return;
      timer = view.setTimeout(() => {
        timer = undefined;
        if (!canHide()) return;
        // A touch-clicked Exit button may retain focus. Move it inside the same
        // viewer before hiding; keyboard focus always keeps controls available.
        if (controls.contains(doc.activeElement)) surface.focus({ preventScroll: true });
        // iPhone's inline Pause/skip menu has its own browser idle policy. Hide
        // it with our idle deadline only in the mobile page fullscreen viewer;
        // touch, pause, seeking, buffering and keyboard use restore it via show().
        // Keep browser controls untouched in normal/desktop/element fullscreen.
        if (surface.classList.contains('video-page-fullscreen') && !doc.fullscreenElement && !doc.webkitFullscreenElement && video.controls) {
          if (doc.activeElement === video) surface.focus({ preventScroll: true });
          nativeControlsHidden = true;
          video.controls = false;
        }
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
      // (including a native playback button) just exposed under the finger.
      // That touch only reveals controls; the always-visible Close stays usable.
      if (!revealTouch || event.detail === 0 || !(event.target instanceof Node) ||
        (event.target !== video && !controls.contains(event.target))) return;
      revealTouch = false; event.preventDefault(); event.stopImmediatePropagation();
    };
    const focused = () => { if (keyboard) schedule(); };
    const browserFullscreenChanged = () => {
      // A slow container request can finish after the page's idle deadline.
      // Hand native control visibility back to the browser on that transition.
      if (doc.fullscreenElement || doc.webkitFullscreenElement) restoreNativeControls();
    };
    const mediaChanged = (event: Event) => {
      // A seek jump is not sustained playback. Genuine waiting/pause also
      // invalidates earlier progress immediately; subsequent motion can recover.
      if (['seeking', 'seeked', 'waiting', 'pause', 'ended', 'emptied', 'error'].includes(event.type)) resetProgress();
      if (iosSeek.enabled && event.type === 'seeking') revealTouch = false;
      reconcile();
    };
    const iosSeek = protectIOSVideoSeek(video, surface, {
      start: () => { revealTouch = controls.classList.contains('video-controls-hidden'); clear(); },
      moved: () => { revealTouch = false; },
      // A native scrub can omit the matching page TouchEvent as well. The
      // last observed iOS pointer release must release that idle hold too.
      end: () => { held = false; schedule(); },
    });
    const events = ['playing', 'play', 'pause', 'ended', 'seeking', 'seeked', 'waiting', 'stalled', 'error', 'emptied', 'canplay', 'progress', 'timeupdate'];
    for (const name of events) video.addEventListener(name, mediaChanged);
    surface.addEventListener('touchstart', touchStart, { capture: true, passive: true });
    surface.addEventListener('touchend', touchEnd, { capture: true, passive: true });
    surface.addEventListener('touchcancel', touchCancel, { capture: true, passive: true });
    surface.addEventListener('pointerdown', pointerDown, true);
    surface.addEventListener('pointerup', pointerUp, true);
    surface.addEventListener('pointercancel', pointerUp, true);
    surface.addEventListener('focusin', focused);
    surface.addEventListener('click', guardRevealClick, true);
    doc.addEventListener('fullscreenchange', browserFullscreenChanged);
    doc.addEventListener('webkitfullscreenchange', browserFullscreenChanged);
    view.addEventListener('keydown', keyDown, true);
    coarse.addEventListener('change', schedule);
    schedule();
    return () => {
      iosSeek.dispose();
      resetProgress();
      show();
      for (const name of events) video.removeEventListener(name, mediaChanged);
      surface.removeEventListener('touchstart', touchStart, true);
      surface.removeEventListener('touchend', touchEnd, true);
      surface.removeEventListener('touchcancel', touchCancel, true);
      surface.removeEventListener('pointerdown', pointerDown, true);
      surface.removeEventListener('pointerup', pointerUp, true);
      surface.removeEventListener('pointercancel', pointerUp, true);
      surface.removeEventListener('focusin', focused);
      surface.removeEventListener('click', guardRevealClick, true);
      doc.removeEventListener('fullscreenchange', browserFullscreenChanged);
      doc.removeEventListener('webkitfullscreenchange', browserFullscreenChanged);
      view.removeEventListener('keydown', keyDown, true);
      coarse.removeEventListener('change', schedule);
    };
  }, [videoRef, surfaceRef, controlsRef, source, fullscreen, error]);
}
