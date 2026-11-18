import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

// PDF-only presentation. Native fullscreen is optional (not available for
// arbitrary elements on many iPhones); the same surface also fills the real
// visible viewport without remounting the document or disturbing other viewers.
export function usePdfPresentation(root: RefObject<HTMLElement>, surface: RefObject<HTMLElement>, enabled: boolean) {
  const [fullscreen, setFullscreen] = useState(false);
  const intent = useRef(false);
  useLayoutEffect(() => {
    if (!enabled || !root.current) return;
    const node = root.current, target = surface.current, viewport = window.visualViewport;
    let frame = 0, native = false;
    const measure = () => {
      const visible = viewport && Math.abs(viewport.scale - 1) < 0.01;
      for (const [key, value] of Object.entries({
        top: visible ? viewport.offsetTop : 0, left: visible ? viewport.offsetLeft : 0,
        width: visible ? viewport.width : window.innerWidth, height: visible ? viewport.height : window.innerHeight,
      })) node.style.setProperty(`--pdf-viewport-${key}`, `${value}px`);
    };
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const changed = () => {
      if (document.fullscreenElement === target) { native = true; setFullscreen(true); }
      else if (native) { native = false; intent.current = false; setFullscreen(false); }
      resize();
    };
    measure();
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      intent.current = false; cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize);
      document.removeEventListener('fullscreenchange', changed);
      if (target && document.fullscreenElement === target) void document.exitFullscreen().catch(() => {});
      for (const key of ['top', 'left', 'width', 'height']) node.style.removeProperty(`--pdf-viewport-${key}`);
    };
  }, [root, surface, enabled]);
  const toggleFullscreen = () => {
    const target = surface.current;
    if (!target) return;
    intent.current = !intent.current; setFullscreen(intent.current);
    if (!intent.current) {
      if (document.fullscreenElement === target) void document.exitFullscreen().catch(() => {});
      return;
    }
    if (!target.requestFullscreen || document.fullscreenEnabled === false) return;
    try {
      void target.requestFullscreen().then(() => {
        if ((!intent.current || !target.isConnected) && document.fullscreenElement === target) void document.exitFullscreen().catch(() => {});
      }).catch(() => { /* Keep the viewport fallback; Close is always available. */ });
    } catch { /* An unsupported native API does not prevent the fallback. */ }
  };
  return { fullscreen, toggleFullscreen };
}
