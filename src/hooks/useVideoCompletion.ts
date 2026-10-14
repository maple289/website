import { useCallback, useEffect, useRef, type RefObject, type SyntheticEvent } from 'react';
import { closeVideoPresentation, releaseVideo, type NativeVideo } from '@/lib/videoFullscreen';

// Closing is a UI action, never a transaction waiting on a browser display mode.
export function useVideoCompletion(videoRef: RefObject<HTMLVideoElement>, rootRef: RefObject<HTMLElement>, source: string | null | undefined, onClose: () => void) {
  const callback = useRef(onClose);
  callback.current = onClose;
  const closed = useRef(false);
  const seekedToEnd = useRef(false);
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    const video = videoRef.current as NativeVideo | null;
    try {
      if (video) {
        try { video.pause(); } catch { /* Continue closing even if the media is unavailable. */ }
        try { closeVideoPresentation(video, rootRef.current); } catch { /* Closing the modal is unconditional. */ }
        releaseVideo(video);
      }
    } finally { callback.current(); }
  }, [videoRef, rootRef]);

  useEffect(() => {
    closed.current = false; seekedToEnd.current = false;
    const video = videoRef.current;
    // Restore the source following the development StrictMode cleanup pass.
    if (video && source && !video.getAttribute('src')) video.src = source;
    return () => { if (video) releaseVideo(video); };
  }, [source, videoRef]);

  const onSeeking = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    seekedToEnd.current = Number.isFinite(video.duration) && video.currentTime >= video.duration;
  };
  const onPlaying = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget.currentTime < event.currentTarget.duration) seekedToEnd.current = false;
  };
  const onEnded = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (!event.currentTarget.loop && !seekedToEnd.current) close();
  };
  return { close, onEnded, onSeeking, onPlaying };
}
