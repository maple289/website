import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { exitPlayerFullscreen, exitPlayerPictureInPicture, waitForVideoPresentation, isNativeVideoFullscreen, updateNativePresentation, type NativeFullscreenState, type NativeVideo } from '@/lib/videoFullscreen';

type Lifetime = { controller: AbortController; fullscreen: NativeFullscreenState; closeRequested: boolean };

export function useVideoCompletion(videoRef: RefObject<HTMLVideoElement>, rootRef: RefObject<HTMLElement>, source: string | null | undefined, onClose: () => void) {
  const callback = useRef(onClose);
  callback.current = onClose;
  const lifetime = useRef<Lifetime | null>(null);
  const pending = useRef(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const close = useCallback(async () => {
    const current = lifetime.current;
    if (!current || pending.current || current.controller.signal.aborted) return;
    current.closeRequested = true;
    pending.current = true; setClosing(true); setCloseError('');
    const video = videoRef.current as NativeVideo | null;
    const { signal } = current.controller;
    try {
      // An entry already requested by a tap must finish before removing its video.
      // This waits for that operation only; it never schedules a new mode entry.
      if (video) await waitForVideoPresentation(video, signal);
      if (signal.aborted) return;
      video?.pause();
      if (video) await exitPlayerFullscreen(video, rootRef.current, current.fullscreen, signal);
      if (video) await exitPlayerPictureInPicture(video, current.fullscreen, signal);
      if (signal.aborted) return;
      if (video) { video.removeAttribute('src'); video.load(); }
      callback.current();
    } catch (error) {
      if (!signal.aborted) {
        if (import.meta.env.DEV) console.warn('Video presentation cleanup failed', error);
        setCloseError('Fullscreen or picture-in-picture could not be closed automatically. Exit the active mode using the player controls to return to the gallery.');
      }
    } finally {
      if (lifetime.current === current) {
        pending.current = false;
        if (!signal.aborted) setClosing(false);
      }
    }
  }, [videoRef, rootRef]);

  useEffect(() => {
    const current: Lifetime = { controller: new AbortController(), fullscreen: { mode: 'unknown' }, closeRequested: false };
    lifetime.current = current;
    pending.current = false; setClosing(false); setCloseError('');
    const video = videoRef.current as NativeVideo | null;
    const doc = video?.ownerDocument ?? document;
    // Restore the source after a development StrictMode effect cleanup.
    if (video && source && !video.getAttribute('src')) video.src = source;
    let seekedToEnd = false, seekingNow = false, completionSignalled = false;
    const finishPlayback = () => {
      if (video && !current.closeRequested && !video.loop && !seekedToEnd && !seekingNow && (!video.seeking || completionSignalled) && !video.error) void close();
    };
    const seeking = () => {
      seekingNow = true; completionSignalled = false;
      seekedToEnd = !!video && Number.isFinite(video.duration) && video.currentTime >= video.duration;
    };
    const seeked = () => { seekingNow = false; if (completionSignalled) finishPlayback(); };
    const playing = () => {
      completionSignalled = false;
      if (video && video.currentTime < video.duration) {
        seekedToEnd = false;
        if (!pending.current) { current.closeRequested = false; setCloseError(''); }
      }
    };
    // The event is the completion signal. Native iPhone controllers can deliver
    // it before the DOM's ended/seeking properties have caught up.
    const ended = () => { completionSignalled = true; finishPlayback(); };
    const recoverCompletion = () => {
      if (current.controller.signal.aborted) return;
      if (current.closeRequested) { void close(); return; }
      if (completionSignalled || video?.ended) finishPlayback();
    };
    const nativeEntered = () => { current.fullscreen.mode = 'fullscreen'; };
    const nativeExited = () => { current.fullscreen.mode = 'inline'; recoverCompletion(); };
    const presentationChanged = () => {
      if (video) updateNativePresentation(video, current.fullscreen);
      recoverCompletion();
    };
    // AVKit may defer the DOM ended event. Recover only from its actual ended
    // state, never elapsed time or currentTime >= duration; scrubbing stays open.
    const nativeProgress = () => {
      if (video && !current.closeRequested && video.ended &&
        (isNativeVideoFullscreen(video, current.fullscreen) || current.fullscreen.mode === 'picture-in-picture' || doc.pictureInPictureElement === video)) recoverCompletion();
    };
    const foreground = () => {
      if (!doc.hidden) {
        if (video) updateNativePresentation(video, current.fullscreen);
        recoverCompletion();
      }
    };
    const events: Array<[string, () => void]> = [
      ['seeking', seeking], ['seeked', seeked], ['playing', playing], ['ended', ended],
      ['webkitbeginfullscreen', nativeEntered], ['webkitendfullscreen', nativeExited],
      ['webkitpresentationmodechanged', presentationChanged], ['timeupdate', nativeProgress],
      ['enterpictureinpicture', () => { current.fullscreen.mode = 'picture-in-picture'; }],
      ['leavepictureinpicture', nativeExited],
    ];
    for (const [name, handler] of events) video?.addEventListener(name, handler);
    doc.addEventListener('fullscreenchange', recoverCompletion);
    doc.addEventListener('webkitfullscreenchange', recoverCompletion);
    doc.addEventListener('visibilitychange', foreground);
    doc.defaultView?.addEventListener('pageshow', foreground);
    return () => {
      current.controller.abort();
      for (const [name, handler] of events) video?.removeEventListener(name, handler);
      doc.removeEventListener('fullscreenchange', recoverCompletion);
      doc.removeEventListener('webkitfullscreenchange', recoverCompletion);
      doc.removeEventListener('visibilitychange', foreground);
      doc.defaultView?.removeEventListener('pageshow', foreground);
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    };
  }, [source, videoRef, close]);
  return { close, closing, closeError };
}
