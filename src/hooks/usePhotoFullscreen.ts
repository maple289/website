import { useEffect, useRef, useState, type RefObject } from 'react';
import type { FullscreenDocument, FullscreenSurface } from '@/lib/videoFullscreen';

export function usePhotoFullscreen(ref: RefObject<HTMLElement>) {
  const [fullscreen, setFullscreen] = useState(false);
  const active = useRef(false);
  const nativeEntered = useRef(false);
  const generation = useRef(0);
  const update = (value: boolean) => { active.current = value; setFullscreen(value); };

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const doc = element.ownerDocument as FullscreenDocument;
    const invalidate = () => { generation.current++; active.current = false; nativeEntered.current = false; };
    const changed = () => {
      const owned = (doc.fullscreenElement ?? doc.webkitFullscreenElement) === element;
      const wasNative = nativeEntered.current;
      nativeEntered.current = owned;
      if (owned && !active.current) {
        // A cancelled request can deliver its native event later, including
        // WebKit void APIs. Do not resurrect fullscreen after an explicit exit.
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
        if (exit) {
          try {
            void Promise.resolve(exit.call(doc)).catch(() => {
              if (ref.current === element) update((doc.fullscreenElement ?? doc.webkitFullscreenElement) === element);
            });
          } catch { update(owned); }
        } else update(owned);
        return;
      }
      if (owned || wasNative) update(owned);
    };
    doc.addEventListener('fullscreenchange', changed);
    doc.addEventListener('webkitfullscreenchange', changed);
    return () => {
      invalidate();
      doc.removeEventListener('fullscreenchange', changed);
      doc.removeEventListener('webkitfullscreenchange', changed);
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
      if ((doc.fullscreenElement ?? doc.webkitFullscreenElement) === element && exit) {
        try { void Promise.resolve(exit.call(doc)).catch(() => {}); } catch { /* Closing must remain available. */ }
      }
    };
  }, [ref]);

  const toggleFullscreen = () => {
    const element = ref.current as FullscreenSurface | null;
    if (!element) return;
    const doc = element.ownerDocument as FullscreenDocument;
    const owned = () => (doc.fullscreenElement ?? doc.webkitFullscreenElement) === element;
    const operation = ++generation.current;
    const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
    if (active.current || owned()) {
      update(false);
      if (owned() && exit) {
        try {
          void Promise.resolve(exit.call(doc)).catch(() => {
            if (ref.current === element && operation === generation.current) update(owned());
          });
        } catch { update(owned()); }
      }
      return;
    }
    // This same state fills the viewport immediately and remains a CSS fallback
    // when container fullscreen is missing or rejected (including iPhone Safari).
    update(true);
    const enter = typeof element.requestFullscreen === 'function' && doc.fullscreenEnabled === true ? element.requestFullscreen :
      element.webkitRequestFullscreen && doc.webkitFullscreenEnabled === true ? element.webkitRequestFullscreen : undefined;
    if (!enter) return;
    try {
      void Promise.resolve(enter.call(element)).then(() => {
        // requestFullscreen can resolve before its queued fullscreenchange is
        // delivered. Remember observed native entry now: a quick system exit may
        // make both queued change events observe null rather than the entry.
        if (ref.current === element && owned()) nativeEntered.current = true;
        // An entry resolving after exit/Close must not leave an orphan fullscreen.
        if ((ref.current !== element || (operation !== generation.current && !active.current)) && owned() && exit) {
          try { void Promise.resolve(exit.call(doc)).catch(() => {}); } catch { /* Best-effort browser cleanup. */ }
        }
      }, () => { /* Keep the complete CSS fullscreen viewer on rejection. */ });
    } catch { /* Keep the complete CSS fullscreen viewer on unsupported entry. */ }
  };
  return { fullscreen, toggleFullscreen };
}
