import { useEffect, useRef } from 'react';

const VOLUME_KEY = 'video-player-volume';
const DEFAULT_VOLUME = 0.5;

function getSavedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0 || v > 1) return DEFAULT_VOLUME;
    return v;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/**
 * Restores the user's saved volume when the <video> element becomes
 * available and persists any volume changes made through the native
 * controls to localStorage.
 *
 * `readyKey` should change whenever a new video URL is loaded so the
 * effect re-runs and restores the saved volume for the new element.
 */
export function useVideoVolume(
  videoRef: React.RefObject<HTMLVideoElement>,
  readyKey: string | null | undefined,
): void {
  const initialized = useRef(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!initialized.current) {
      el.volume = getSavedVolume();
      initialized.current = true;
    }

    const onVolumeChange = () => {
      try {
        localStorage.setItem(VOLUME_KEY, String(el.volume));
      } catch {
        // ignore storage errors
      }
    };

    el.addEventListener('volumechange', onVolumeChange);
    return () => {
      el.removeEventListener('volumechange', onVolumeChange);
    };
  }, [videoRef, readyKey]);
}
