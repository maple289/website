import { useSyncExternalStore, useCallback } from 'react';

/** mute/unmute/ended and stream replacement must mask decoded frames immediately. */
export function useVideoTrackState(stream: MediaStream | null, permitted = true) {
  const snapshot = useCallback(() => !!stream?.getVideoTracks().some(track => track.enabled && !track.muted && track.readyState === 'live'), [stream]);
  const subscribe = useCallback((changed: () => void) => {
    if (!stream) return () => {};
    let watched: MediaStreamTrack[] = [];
    const clear = () => {
      for (const track of watched) for (const event of ['mute', 'unmute', 'ended']) track.removeEventListener(event, changed);
    };
    const bind = () => {
      clear(); watched = stream.getVideoTracks();
      for (const track of watched) for (const event of ['mute', 'unmute', 'ended']) track.addEventListener(event, changed);
      changed();
    };
    bind(); stream.addEventListener('addtrack', bind); stream.addEventListener('removetrack', bind);
    // enabled and explicit stop() do not emit a state-change event in every browser.
    const timer = window.setInterval(() => {
      const tracks = stream.getVideoTracks();
      if (tracks.length !== watched.length || tracks.some((track, index) => track !== watched[index])) bind();
      else changed();
    }, 250);
    return () => { clear(); stream.removeEventListener('addtrack', bind); stream.removeEventListener('removetrack', bind); window.clearInterval(timer); };
  }, [stream]);
  const live = useSyncExternalStore(subscribe, snapshot, () => false);
  return permitted && live;
}
