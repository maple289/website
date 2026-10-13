import { useEffect, useRef, useState, type RefObject } from 'react';
import { beginVideoPresentation, type FullscreenDocument, type NativeVideo } from '@/lib/videoFullscreen';

type FullscreenSurface = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type Snapshot = { fullscreen: boolean; pip: boolean; canFullscreen: boolean; canPip: boolean };
const empty: Snapshot = { fullscreen: false, pip: false, canFullscreen: false, canPip: false };

function capabilities(video: NativeVideo, surface: FullscreenSurface) {
  const doc = video.ownerDocument as FullscreenDocument;
  const standard = !!surface.requestFullscreen && doc.fullscreenEnabled !== false;
  const vendor = !!surface.webkitRequestFullscreen && doc.webkitFullscreenEnabled !== false;
  const metadataReady = video.readyState >= HTMLMediaElement.HAVE_METADATA;
  return {
    standard, vendor,
    native: metadataReady && (!!(video.webkitEnterFullscreen || video.webkitEnterFullScreen) ||
      !!video.webkitSetPresentationMode && !!video.webkitSupportsPresentationMode?.('fullscreen')),
    standardPip: metadataReady && !!video.requestPictureInPicture && !!doc.pictureInPictureEnabled,
    nativePip: metadataReady && !!video.webkitSetPresentationMode && !!video.webkitSupportsPresentationMode?.('picture-in-picture'),
  };
}

export function useVideoPresentation(videoRef: RefObject<HTMLVideoElement>, surfaceRef: RefObject<HTMLElement>, source: string | null | undefined) {
  const [state, setState] = useState(empty);
  const [fullscreenPending, setFullscreenPending] = useState(false);
  const [pipPending, setPipPending] = useState(false);
  const [error, setError] = useState('');
  // Distinct operations, with no queued entry intent or effect that calls an API.
  const fullscreenBusy = useRef(false), pipBusy = useRef(false);
  const sync = useRef<() => Snapshot>(() => empty);
  const alive = useRef(false);
  const generation = useRef(0);
  const operation = useRef({ fullscreen: 0, pip: 0 });
  const presentation = useRef<ReturnType<typeof beginVideoPresentation> | null>(null);

  useEffect(() => {
    alive.current = true;
    generation.current++;
    fullscreenBusy.current = false; pipBusy.current = false;
    setFullscreenPending(false); setPipPending(false); setError('');
    const video = videoRef.current as NativeVideo | null;
    const surface = surfaceRef.current as FullscreenSurface | null;
    if (!video || !surface) { setState(empty); return () => { alive.current = false; }; }
    const doc = video.ownerDocument as FullscreenDocument;
    let nativeMode: NativeVideo['webkitPresentationMode'];
    const read = () => {
      const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      const owns = !!element && (surface.contains(element) || element.contains(video));
      const mode = nativeMode ?? video.webkitPresentationMode;
      const cap = capabilities(video, surface);
      const fullscreen = owns || mode === 'fullscreen' || (!mode && !!video.webkitDisplayingFullscreen);
      const pip = !fullscreen && (doc.pictureInPictureElement === video || mode === 'picture-in-picture');
      const next = { fullscreen, pip, canFullscreen: cap.standard || cap.vendor || cap.native, canPip: cap.standardPip || cap.nativePip };
      setState(next);
      return next;
    };
    sync.current = read;
    const complete = () => {
      read(); fullscreenBusy.current = false; pipBusy.current = false;
      presentation.current?.settle(); presentation.current = null;
      operation.current.fullscreen++; operation.current.pip++;
      setFullscreenPending(false); setPipPending(false);
    };
    const entered = () => { nativeMode = 'fullscreen'; video.controls = true; complete(); };
    const left = () => { nativeMode = 'inline'; video.controls = false; complete(); };
    const pipEntered = () => { nativeMode = 'picture-in-picture'; complete(); };
    const presentationChanged = () => { nativeMode = video.webkitPresentationMode; video.controls = nativeMode === 'fullscreen'; complete(); };
    const failed = () => {
      complete(); setError('The browser could not change fullscreen. Please try again.');
      if (import.meta.env.DEV) console.warn('Video fullscreenerror event');
    };
    const events: Array<[string, () => void]> = [
      ['loadedmetadata', read], ['webkitbeginfullscreen', entered], ['webkitendfullscreen', left],
      ['webkitpresentationmodechanged', presentationChanged], ['enterpictureinpicture', pipEntered], ['leavepictureinpicture', left],
    ];
    for (const [name, handler] of events) video.addEventListener(name, handler);
    doc.addEventListener('fullscreenchange', complete);
    doc.addEventListener('webkitfullscreenchange', complete);
    doc.addEventListener('fullscreenerror', failed);
    doc.addEventListener('webkitfullscreenerror', failed);
    read();
    return () => {
      alive.current = false; sync.current = () => empty;
      presentation.current?.settle(); presentation.current = null;
      for (const [name, handler] of events) video.removeEventListener(name, handler);
      doc.removeEventListener('fullscreenchange', complete);
      doc.removeEventListener('webkitfullscreenchange', complete);
      doc.removeEventListener('fullscreenerror', failed);
      doc.removeEventListener('webkitfullscreenerror', failed);
    };
  }, [source, videoRef, surfaceRef]);

  const request = (kind: 'fullscreen' | 'pip') => {
    const video = videoRef.current as NativeVideo | null;
    const surface = surfaceRef.current as FullscreenSurface | null;
    if (!video || !surface || fullscreenBusy.current || pipBusy.current) return;
    const actual = sync.current();
    // A transition needing an asynchronous exit cannot reuse this tap's activation.
    // Require an explicit exit first; never queue the other mode for a later tap.
    if (kind === 'fullscreen' ? actual.pip : actual.fullscreen) return;
    const doc = video.ownerDocument as FullscreenDocument;
    const cap = capabilities(video, surface);
    const busy = kind === 'fullscreen' ? fullscreenBusy : pipBusy;
    const currentGeneration = generation.current;
    const currentOperation = ++operation.current[kind];
    const setPending = kind === 'fullscreen' ? setFullscreenPending : setPipPending;
    busy.current = true; setPending(true); setError('');
    const currentPresentation = beginVideoPresentation(video);
    presentation.current = currentPresentation;
    const failed = (reason: unknown) => {
      currentPresentation.settle();
      if (import.meta.env.DEV && alive.current && generation.current === currentGeneration) console.warn(`Video ${kind} request failed`, reason);
      if (!alive.current || generation.current !== currentGeneration || operation.current[kind] !== currentOperation) return;
      busy.current = false; setPending(false); sync.current();
      setError(`The browser could not ${kind === 'fullscreen' ? 'change fullscreen' : 'change picture-in-picture'}. Please try again.`);
    };
    try {
      let result: void | Promise<unknown>;
      // Every invocation below happens synchronously on the button's original tap.
      if (kind === 'fullscreen') {
        if (actual.fullscreen) {
          const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
          const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
          if (element && exit) result = exit.call(doc);
          else if (video.webkitExitFullscreen || video.webkitExitFullScreen) result = (video.webkitExitFullscreen ?? video.webkitExitFullScreen)!.call(video);
          else if (video.webkitSetPresentationMode) result = video.webkitSetPresentationMode('inline');
          else throw new Error('Fullscreen exit unavailable');
        } else if (cap.standard) result = surface.requestFullscreen();
        else if (cap.vendor) result = surface.webkitRequestFullscreen!();
        else if (cap.native && (video.webkitEnterFullscreen || video.webkitEnterFullScreen)) result = (video.webkitEnterFullscreen ?? video.webkitEnterFullScreen)!.call(video);
        else if (cap.native) result = video.webkitSetPresentationMode!('fullscreen');
        else throw new Error('Fullscreen unavailable');
      } else if (actual.pip) {
        if (doc.pictureInPictureElement === video && doc.exitPictureInPicture) result = doc.exitPictureInPicture();
        else if (video.webkitSetPresentationMode) result = video.webkitSetPresentationMode('inline');
        else throw new Error('Picture-in-picture exit unavailable');
      } else if (cap.standardPip) result = video.requestPictureInPicture();
      else if (cap.nativePip) result = video.webkitSetPresentationMode!('picture-in-picture');
      else throw new Error('Picture-in-picture unavailable');
      if (result && typeof result.then === 'function') {
        void result.then(() => {
          currentPresentation.settle();
          if (!alive.current || generation.current !== currentGeneration || operation.current[kind] !== currentOperation) return;
          busy.current = false; setPending(false); sync.current();
        }, failed);
      }
      // Native void APIs settle on browser events, not an optimistic boolean.
    } catch (reason) { failed(reason); }
  };

  return { ...state, fullscreenPending, pipPending, error,
    toggleFullscreen: () => request('fullscreen'), togglePip: () => request('pip') };
}
