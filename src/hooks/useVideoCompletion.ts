import { useCallback, useEffect, useRef, type RefObject, type SyntheticEvent } from 'react';
import { closeVideoPresentation, releaseVideo, type NativeVideo } from '@/lib/videoFullscreen';

function usesNativeTouchPresentation(video: NativeVideo) {
  return typeof video.webkitSetPresentationMode === 'function' &&
    (video.ownerDocument.defaultView?.navigator.maxTouchPoints ?? 0) > 0;
}

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
    const video = videoRef.current as NativeVideo | null;
    // Restore the source following the development StrictMode cleanup pass.
    if (video && source && !video.getAttribute('src')) video.src = source;
    const recoverNativeCompletion = () => {
      if (video?.ended && !video.loop && !video.seeking && !video.error) close();
    };
    const nativePresentation = !!video && usesNativeTouchPresentation(video);
    if (nativePresentation) {
      video.addEventListener('seeked', recoverNativeCompletion);
      video?.addEventListener('webkitendfullscreen', recoverNativeCompletion);
      video?.addEventListener('webkitpresentationmodechanged', recoverNativeCompletion);
    }
    return () => {
      if (video) {
        video.removeEventListener('seeked', recoverNativeCompletion);
        video.removeEventListener('webkitendfullscreen', recoverNativeCompletion);
        video.removeEventListener('webkitpresentationmodechanged', recoverNativeCompletion);
        releaseVideo(video);
      }
    };
  }, [source, videoRef, close]);

  const onSeeking = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    seekedToEnd.current = Number.isFinite(video.duration) && video.currentTime >= video.duration;
  };
  const onPlaying = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget.currentTime < event.currentTarget.duration) seekedToEnd.current = false;
  };
  const onEnded = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget as NativeVideo;
    // Native completion takes precedence over a seek reported at the end.
    if (!video.loop && (!seekedToEnd.current || usesNativeTouchPresentation(video))) close();
  };
  return { close, onEnded, onSeeking, onPlaying };
}
