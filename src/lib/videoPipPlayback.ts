import type { FullscreenDocument } from './videoFullscreen';

const returnWindowMs = 1500;

// Standard PiP can hand playback back to fullscreen with pause/leave/fullscreen
// events in different orders. Keep this separate from WebKit presentation modes.
export function preserveVideoPipPlayback(video: HTMLVideoElement, surface: HTMLElement) {
  const doc = video.ownerDocument as FullscreenDocument, view = doc.defaultView;
  const source = video.getAttribute('src');
  let disposed = false, inPip = doc.pictureInPictureElement === video, session = 0;
  let pipPlaying = inPip && !video.paused, resume = false, explicitExit = false;
  let focusedAt = -Infinity;
  let timeout: number | undefined;
  const fullscreen = () => {
    const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
    return surface.classList.contains('video-page-fullscreen') ||
      !!element && (surface.contains(element) || element.contains(video));
  };
  const returnedToPage = () => !!view && doc.hasFocus() && view.performance.now() - focusedAt <= returnWindowMs;
  const cancel = () => { resume = false; explicitExit = false; focusedAt = -Infinity; view?.clearTimeout(timeout); timeout = undefined; };
  const recover = () => {
    if (!resume || disposed || !video.isConnected || video.getAttribute('src') !== source ||
      doc.hidden || doc.pictureInPictureElement === video || (!explicitExit && !fullscreen() && !returnedToPage()) ||
      video.ended || video.error || !video.paused) return;
    cancel(); // One attempt only; rejected autoplay must never become a retry loop.
    try { void video.play().catch(() => { /* Native Play remains available if the browser requires another gesture. */ }); }
    catch { /* Keep the existing video and native playback controls. */ }
  };
  const returning = () => {
    resume = pipPlaying;
    view?.clearTimeout(timeout);
    // Do not carry playback intent into an unrelated, later fullscreen action.
    timeout = view?.setTimeout(cancel, returnWindowMs);
    recover();
  };
  const entered = () => { cancel(); session++; inPip = true; pipPlaying = !video.paused && !video.ended; };
  const left = () => {
    if (!inPip) return;
    inPip = false;
    if (!video.paused && !video.ended) pipPlaying = true;
    returning();
  };
  const playing = () => {
    if (doc.pictureInPictureElement === video) pipPlaying = true;
    else if (resume) cancel();
  };
  const paused = () => {
    // A pause while still in PiP is the user's playback state. A queued pause
    // after the browser clears PiP belongs to the handoff, not a new pause choice.
    if (doc.pictureInPictureElement === video && !fullscreen()) pipPlaying = false;
    else recover();
  };
  const interacted = (event: Event) => {
    // Keep intent for the explicit Fullscreen action; native playback controls,
    // other buttons and keyboard actions cancel recovery before changing state.
    if (event.target instanceof Element && event.target.closest('[data-video-fullscreen-toggle]')) return;
    pipPlaying = false; cancel();
  };
  const focused = () => {
    // Android's native expand control may activate the originating page instead
    // of setting a DOM fullscreen element. Require a fresh focus return, not
    // merely a page that was already visible when the PiP window was dismissed.
    if (!inPip && !resume) return;
    focusedAt = view?.performance.now() ?? -Infinity;
    recover();
  };
  const events: Array<[string, EventListener]> = [
    ['enterpictureinpicture', entered], ['leavepictureinpicture', left],
    ['play', playing], ['pause', paused], ['ended', cancel], ['emptied', cancel], ['error', cancel],
  ];
  for (const [name, handler] of events) video.addEventListener(name, handler);
  doc.addEventListener('fullscreenchange', recover); doc.addEventListener('webkitfullscreenchange', recover);
  doc.addEventListener('visibilitychange', recover);
  view?.addEventListener('focus', focused);
  surface.addEventListener('pointerdown', interacted, true); surface.addEventListener('keydown', interacted, true);
  return {
    exit() {
      // Only this explicit page action may preserve playback on return to inline.
      // A system PiP close must not restart the video in the background.
      pipPlaying = !video.paused && !video.ended; explicitExit = true;
      const exitingSession = session;
      try {
        return doc.exitPictureInPicture!().then(() => {
          if (disposed || session !== exitingSession) return;
          if (inPip) { inPip = false; returning(); } else recover();
        }, error => { if (session === exitingSession) cancel(); throw error; });
      } catch (error) { cancel(); throw error; }
    },
    dispose() {
      disposed = true; cancel();
      for (const [name, handler] of events) video.removeEventListener(name, handler);
      doc.removeEventListener('fullscreenchange', recover); doc.removeEventListener('webkitfullscreenchange', recover);
      doc.removeEventListener('visibilitychange', recover);
      view?.removeEventListener('focus', focused);
      surface.removeEventListener('pointerdown', interacted, true); surface.removeEventListener('keydown', interacted, true);
    },
  };
}
