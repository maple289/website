import { useEffect, useRef, useState, type RefObject } from 'react';
import { closeVideoPresentation, setVideoPageFullscreen, type FullscreenDocument, type FullscreenSurface, type NativeVideo } from '@/lib/videoFullscreen';
import { listenForMediaDoubleTap } from '@/lib/mediaDoubleTap';
import { preserveVideoPipPlayback } from '@/lib/videoPipPlayback';
import { isIOSTouchVideo } from '@/lib/iosVideoSeek';

const empty = { fullscreen: false, pip: false, canFullscreen: false, canPip: false };
type Snapshot = typeof empty;
function capabilities(video: NativeVideo, surface: FullscreenSurface) {
  const doc = video.ownerDocument as FullscreenDocument;
  const ready = video.readyState >= HTMLMediaElement.HAVE_METADATA;
  return {
    standard: !!surface.requestFullscreen && doc.fullscreenEnabled === true,
    vendor: !!surface.webkitRequestFullscreen && doc.webkitFullscreenEnabled === true,
    native: ready && video.webkitSupportsFullscreen !== false && !!(video.webkitEnterFullscreen || video.webkitEnterFullScreen),
    presentation: ready && !!video.webkitSetPresentationMode && video.webkitSupportsPresentationMode?.('fullscreen') === true,
    pip: ready && !!video.requestPictureInPicture && doc.pictureInPictureEnabled === true,
    nativePip: ready && !!video.webkitSetPresentationMode && video.webkitSupportsPresentationMode?.('picture-in-picture') === true,
  };
}

export function useVideoPresentation(videoRef: RefObject<HTMLVideoElement>, surfaceRef: RefObject<HTMLElement>, source: string | null | undefined) {
  const [state, setState] = useState(empty);
  const [error, setError] = useState('');
  const sync = useRef<() => Snapshot>(() => empty);
  const fullscreenAction = useRef(() => {});
  const pipPlayback = useRef<ReturnType<typeof preserveVideoPipPlayback> | null>(null);
  useEffect(() => {
    const video = videoRef.current as NativeVideo | null, surface = surfaceRef.current as FullscreenSurface | null;
    setError('');
    if (!video || !surface) { setState(empty); return; }
    const doc = video.ownerDocument as FullscreenDocument;
    const playback = preserveVideoPipPlayback(video, surface);
    pipPlayback.current = playback;
    let nativeMode: NativeVideo['webkitPresentationMode'];
    let wasOwnedFullscreen = false;
    const read = () => {
      const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      const owned = !!element && (surface.contains(element) || element.contains(video));
      if (wasOwnedFullscreen && !owned) setVideoPageFullscreen(surface, false);
      wasOwnedFullscreen = owned;
      const nativeFullscreen = nativeMode === undefined ? video.webkitPresentationMode === 'fullscreen' || !!video.webkitDisplayingFullscreen : nativeMode === 'fullscreen';
      const fullscreen = surface.classList.contains('video-page-fullscreen') || owned || nativeFullscreen;
      const pip = !fullscreen && (doc.pictureInPictureElement === video || (nativeMode ?? video.webkitPresentationMode) === 'picture-in-picture');
      const cap = capabilities(video, surface);
      const next = { fullscreen, pip, canFullscreen: fullscreen || cap.standard || cap.vendor || cap.native || cap.presentation, canPip: pip || cap.pip || cap.nativePip };
      setState(next); return next;
    };
    sync.current = read;
    const entered = () => { nativeMode = 'fullscreen'; read(); };
    const left = () => { setVideoPageFullscreen(surface, false); nativeMode = 'inline'; read(); };
    const presentationChanged = () => {
      if (video.webkitPresentationMode !== undefined) nativeMode = video.webkitPresentationMode;
      if (nativeMode === 'picture-in-picture') setVideoPageFullscreen(surface, false);
      read();
    };
    const pipEntered = () => { setVideoPageFullscreen(surface, false); nativeMode = 'picture-in-picture'; read(); };
    // Leaving PiP can be part of entering fullscreen. It is not a fullscreen
    // exit and must not tear down a presentation the browser just restored.
    const pipLeft = () => { if (nativeMode === 'picture-in-picture') nativeMode = 'inline'; read(); };
    const failed = () => { read(); if (!surface.classList.contains('video-page-fullscreen')) setError('Fullscreen is unavailable. You can continue playing or close the video.'); };
    const events: Array<[string, () => void]> = [
      ['loadedmetadata', read], ['webkitbeginfullscreen', entered], ['webkitendfullscreen', left],
      ['webkitpresentationmodechanged', presentationChanged], ['enterpictureinpicture', pipEntered], ['leavepictureinpicture', pipLeft],
    ];
    for (const [name, handler] of events) video.addEventListener(name, handler);
    doc.addEventListener('fullscreenchange', read); doc.addEventListener('webkitfullscreenchange', read);
    doc.addEventListener('fullscreenerror', failed); doc.addEventListener('webkitfullscreenerror', failed);
    // Native controls live in an opaque browser shadow tree. Reserve their
    // bottom strip and paused central play button as well as explicit controls.
    const mediaPoint = (target: EventTarget | null, x: number, y: number) => {
      if (target !== video) return false;
      const rect = video.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom - (video.controls || isIOSTouchVideo(video) ? 64 : 0)) return false;
      return !video.controls || !video.paused || Math.abs(x - (rect.left + rect.width / 2)) > 32 || Math.abs(y - (rect.top + rect.height / 2)) > 32;
    };
    let lastTouch = -Infinity;
    const touched = () => { lastTouch = performance.now(); };
    const removeDoubleTap = listenForMediaDoubleTap(surface, () => fullscreenAction.current(),
      (event, touch) => mediaPoint(event.target, touch.clientX, touch.clientY));
    const doubleClick = (event: MouseEvent) => {
      if (performance.now() - lastTouch < 750 || !mediaPoint(event.target, event.clientX, event.clientY)) return;
      event.preventDefault();
      event.stopPropagation(); // Do not also run the browser's native double-click action.
      fullscreenAction.current();
    };
    surface.addEventListener('touchstart', touched, { passive: true, capture: true });
    surface.addEventListener('dblclick', doubleClick, true);
    read();
    return () => {
      playback.dispose();
      if (pipPlayback.current === playback) pipPlayback.current = null;
      setVideoPageFullscreen(surface, false);
      sync.current = () => empty;
      for (const [name, handler] of events) video.removeEventListener(name, handler);
      doc.removeEventListener('fullscreenchange', read); doc.removeEventListener('webkitfullscreenchange', read);
      doc.removeEventListener('fullscreenerror', failed); doc.removeEventListener('webkitfullscreenerror', failed);
      removeDoubleTap();
      surface.removeEventListener('touchstart', touched, true);
      surface.removeEventListener('dblclick', doubleClick, true);
    };
  }, [source, videoRef, surfaceRef]);

  const observe = (result: unknown, video: NativeVideo, surface: HTMLElement, message: string, pageFallback = false) => {
    // Native WebKit methods return void. Their events alone confirm success;
    // they never create an unresolved application pending state.
    if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return;
    void Promise.resolve(result).then(() => {
      if (videoRef.current === video && video.isConnected) {
        // An explicit exit can precede a slow container entry. Complete that
        // exit rather than resurrecting fullscreen after the second double tap.
        if (pageFallback && !surface.classList.contains('video-page-fullscreen')) {
          const doc = video.ownerDocument as FullscreenDocument;
          const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
          const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
          if (element && (surface.contains(element) || element.contains(video)) && exit) {
            try { void Promise.resolve(exit.call(doc)).catch(() => {}); } catch { /* Actual mode remains observable and Close stays available. */ }
          }
        }
        sync.current();
      }
      else closeVideoPresentation(video, surface.isConnected ? null : surface);
    }, () => { if (videoRef.current === video && video.isConnected) { sync.current(); if (!pageFallback) setError(message); } });
  };
  const toggleFullscreen = () => {
    const video = videoRef.current as NativeVideo | null, surface = surfaceRef.current as FullscreenSurface | null;
    if (!video || !surface) return;
    const actual = sync.current(), doc = video.ownerDocument as FullscreenDocument, cap = capabilities(video, surface);
    if (actual.pip) return;
    setError('');
    const message = 'Fullscreen is unavailable. You can continue playing or close the video.';
    try {
      let result: unknown;
      if (actual.fullscreen) {
        const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
        const native = !element || !(surface.contains(element) || element.contains(video));
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
        const pageFullscreen = surface.classList.contains('video-page-fullscreen');
        setVideoPageFullscreen(surface, false);
        if (pageFullscreen && native) { sync.current(); return; }
        if (native && (video.webkitExitFullscreen || video.webkitExitFullScreen)) result = (video.webkitExitFullscreen ?? video.webkitExitFullScreen)!.call(video);
        else if ((doc.fullscreenElement ?? doc.webkitFullscreenElement) && exit) result = exit.call(doc);
        else if (video.webkitSetPresentationMode) result = video.webkitSetPresentationMode('inline');
        else throw new Error('Unsupported fullscreen exit');
      } else if ((cap.presentation || cap.native) && (doc.defaultView?.navigator.maxTouchPoints ?? 0) > 0) {
        // The iPhone system player owns its touches; page gestures cannot exit
        // it. Keep this same video and controls in the page's fullscreen viewer.
        setVideoPageFullscreen(surface, true);
        sync.current();
        if (cap.standard) result = surface.requestFullscreen();
        else if (cap.vendor) result = surface.webkitRequestFullscreen!();
      } else if (cap.standard) result = surface.requestFullscreen();
      else if (cap.vendor) result = surface.webkitRequestFullscreen!();
      else if (cap.native) result = (video.webkitEnterFullscreen ?? video.webkitEnterFullScreen)!.call(video);
      else if (cap.presentation) result = video.webkitSetPresentationMode!('fullscreen');
      else throw new Error('Unsupported fullscreen');
      observe(result, video, surface, message, surface.classList.contains('video-page-fullscreen'));
      sync.current();
    } catch { sync.current(); if (!surface.classList.contains('video-page-fullscreen')) setError(message); }
  };
  fullscreenAction.current = toggleFullscreen;
  const togglePip = () => {
    const video = videoRef.current as NativeVideo | null, surface = surfaceRef.current;
    if (!video || !surface) return;
    const actual = sync.current(), doc = video.ownerDocument, cap = capabilities(video, surface);
    if (actual.fullscreen) return;
    setError('');
    const message = 'Picture-in-picture is unavailable. You can continue playing or close the video.';
    try {
      let result: unknown;
      if (actual.pip && doc.pictureInPictureElement === video && doc.exitPictureInPicture) result = pipPlayback.current?.exit() ?? doc.exitPictureInPicture();
      else if (actual.pip && video.webkitSetPresentationMode) result = video.webkitSetPresentationMode('inline');
      else if (cap.pip) result = video.requestPictureInPicture();
      else if (cap.nativePip) result = video.webkitSetPresentationMode!('picture-in-picture');
      else throw new Error('Unsupported picture-in-picture');
      observe(result, video, surface, message);
    } catch { sync.current(); setError(message); }
  };
  return { ...state, error, toggleFullscreen, togglePip };
}
