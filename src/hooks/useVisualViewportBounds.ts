import { useLayoutEffect, type RefObject } from 'react';

/** Keep a fixed surface inside the space above browser chrome/the keyboard. */
export function useVisualViewportBounds(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      // Respect pinch zoom: shrinking the interface during zoom would cancel it.
      const useVisual = viewport && Math.abs(viewport.scale - 1) < 0.01;
      const width = useVisual ? viewport.width : window.innerWidth;
      const height = useVisual ? viewport.height : window.innerHeight;
      const left = useVisual ? viewport.offsetLeft : 0;
      const top = useVisual ? viewport.offsetTop : 0;
      const values = { width, height, left, top,
        right: Math.max(0, window.innerWidth - left - width),
        bottom: Math.max(0, window.innerHeight - top - height) };
      for (const [key, value] of Object.entries(values)) node.style.setProperty(`--call-viewport-${key}`, `${value}px`);
    };
    const changed = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('resize', changed);
    viewport?.addEventListener('resize', changed);
    viewport?.addEventListener('scroll', changed);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', changed);
      viewport?.removeEventListener('resize', changed);
      viewport?.removeEventListener('scroll', changed);
      for (const key of ['width', 'height', 'left', 'top', 'right', 'bottom']) node.style.removeProperty(`--call-viewport-${key}`);
    };
  }, [ref]);
}
