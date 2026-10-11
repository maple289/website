import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Layout changes keep the media container and peer connections mounted. */
export function useCallFullscreen(ref: RefObject<HTMLElement>) {
  const [fullscreen, setFullscreen] = useState(false);
  const mounted = useRef(false), pending = useRef(false), intent = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const node = ref.current;
    const changed = () => {
      intent.current = document.fullscreenElement === node;
      setFullscreen(intent.current);
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      mounted.current = false; intent.current = false;
      document.removeEventListener('fullscreenchange', changed);
      if (node && document.fullscreenElement === node) void document.exitFullscreen().catch(() => {});
    };
  }, [ref]);
  const enter = useCallback(() => {
    const node = ref.current;
    if (!node || pending.current) return;
    intent.current = true;
    // CSS fallback is independent of whether the browser grants native fullscreen.
    setFullscreen(true);
    if (!node.requestFullscreen || document.fullscreenEnabled === false) return;
    pending.current = true;
    try {
      void node.requestFullscreen().catch(() => {
        if (mounted.current) setFullscreen(intent.current);
      }).finally(() => {
        pending.current = false;
        if (!mounted.current && document.fullscreenElement === node) void document.exitFullscreen().catch(() => {});
      });
    } catch { pending.current = false; }
  }, [ref]);
  const exit = useCallback(async () => {
    if (pending.current) return false;
    intent.current = false;
    if (document.fullscreenElement === ref.current) {
      pending.current = true;
      try { await document.exitFullscreen(); } catch { intent.current = true; }
      finally { pending.current = false; }
      if (mounted.current) setFullscreen(document.fullscreenElement === ref.current);
      return document.fullscreenElement !== ref.current;
    }
    setFullscreen(false);
    return true;
  }, [ref]);
  return { fullscreen, enter, exit };
}
