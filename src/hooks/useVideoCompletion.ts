import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type NativeVideo = HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitExitFullscreen?: () => void };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void | Promise<void> };

// Wait for native Safari's asynchronous exit as well as the standard API. The
// timeout only bounds fullscreen cleanup; playback completion never uses a timer.
async function exitPlayerFullscreen(video: NativeVideo, root: HTMLElement | null, signal: AbortSignal) {
  const doc = video.ownerDocument as FullscreenDocument;
  const element = () => doc.fullscreenElement ?? doc.webkitFullscreenElement;
  const ownsFullscreen = () => !!element() && (!!root?.contains(element()!) || !!element()?.contains(video));
  const active = () => ownsFullscreen() || !!video.webkitDisplayingFullscreen;
  if (!active()) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      doc.removeEventListener('fullscreenchange', changed);
      doc.removeEventListener('webkitfullscreenchange', changed);
      video.removeEventListener('webkitendfullscreen', changed);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const changed = () => { if (!active()) finish(); };
    const aborted = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = window.setTimeout(() => active() ? finish(new Error('Fullscreen did not exit.')) : finish(), 2000);
    doc.addEventListener('fullscreenchange', changed);
    doc.addEventListener('webkitfullscreenchange', changed);
    video.addEventListener('webkitendfullscreen', changed);
    signal.addEventListener('abort', aborted, { once: true });
    try {
      if (signal.aborted) { aborted(); return; }
      const exits: Promise<unknown>[] = [];
      if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) video.webkitExitFullscreen();
      if (ownsFullscreen()) {
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        if (!exit) throw new Error('Fullscreen exit is unavailable.');
        exits.push(Promise.resolve(exit.call(doc)));
      }
      void Promise.all(exits).then(changed, finish);
    } catch (error) { finish(error instanceof Error ? error : new Error('Fullscreen did not exit.')); }
  });
}

export function useVideoCompletion(videoRef: RefObject<HTMLVideoElement>, rootRef: RefObject<HTMLElement>, source: string | null | undefined, onClose: () => void) {
  const callback = useRef(onClose);
  callback.current = onClose;
  const lifetime = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const close = useCallback(async () => {
    if (pending.current || lifetime.current?.signal.aborted) return;
    pending.current = true; setClosing(true); setCloseError('');
    const video = videoRef.current;
    const signal = lifetime.current?.signal;
    try {
      video?.pause();
      if (video && signal) await exitPlayerFullscreen(video, rootRef.current, signal);
      if (signal?.aborted) return;
      if (video) { video.removeAttribute('src'); video.load(); }
      callback.current();
    } catch {
      if (!signal?.aborted) setCloseError('Exit fullscreen using the player controls, then close the video.');
    } finally {
      if (lifetime.current?.signal === signal) {
        pending.current = false;
        if (!signal?.aborted) setClosing(false);
      }
    }
  }, [videoRef, rootRef]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    pending.current = false; setClosing(false); setCloseError('');
    const video = videoRef.current;
    // Restore the source after a development StrictMode effect cleanup.
    if (video && source && !video.getAttribute('src')) video.src = source;
    let seekedToEnd = false;
    const seeking = () => { seekedToEnd = !!video && Number.isFinite(video.duration) && video.currentTime >= video.duration; };
    const playing = () => { if (video && video.currentTime < video.duration) seekedToEnd = false; };
    const ended = () => { if (video?.ended && !video.seeking && !video.loop && !seekedToEnd) void close(); };
    video?.addEventListener('seeking', seeking);
    video?.addEventListener('playing', playing);
    video?.addEventListener('ended', ended);
    return () => {
      controller.abort();
      video?.removeEventListener('seeking', seeking);
      video?.removeEventListener('playing', playing);
      video?.removeEventListener('ended', ended);
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    };
  }, [source, videoRef, close]);
  return { close, closing, closeError };
}
