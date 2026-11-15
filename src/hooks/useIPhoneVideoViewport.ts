import { useLayoutEffect, type RefObject } from 'react';

/** Normal iPhone viewer geometry only; presentation modes keep their own sizing. */
export function useIPhoneVideoViewport(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !/iPhone|iPod/i.test(navigator.userAgent)) return;
    const viewport = window.visualViewport;
    let frame = 0;
    root.classList.add('iphone-video-viewport');
    const measure = () => {
      frame = 0;
      // Leave accessibility pinch zoom to the browser.
      if (viewport && Math.abs(viewport.scale - 1) > .01) return;
      const values = {
        height: viewport?.height ?? window.innerHeight,
        width: viewport?.width ?? window.innerWidth,
        top: viewport?.offsetTop ?? 0,
        left: viewport?.offsetLeft ?? 0,
      };
      if (values.height <= 0 || values.width <= 0 || !Object.values(values).every(Number.isFinite)) return;
      for (const [key, value] of Object.entries(values)) {
        root.style.setProperty(`--iphone-video-${key}`, `${value}px`);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      root.classList.remove('iphone-video-viewport');
      for (const key of ['height', 'width', 'top', 'left']) root.style.removeProperty(`--iphone-video-${key}`);
    };
  }, [ref]);
}
