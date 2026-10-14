// Touch-only recognition. The action runs synchronously in touchend so browser
// fullscreen APIs retain the user activation from the second tap.
export function listenForMediaDoubleTap(
  element: HTMLElement,
  action: () => void,
  accepts: (event: TouchEvent, touch: Touch) => boolean,
) {
  const interval = 300, movement = 12, proximity = 32;
  let start: { x: number; y: number; time: number } | null = null;
  let previous: { x: number; y: number; time: number } | null = null;
  const reset = () => { start = null; previous = null; };
  const begin = (event: TouchEvent) => {
    if (event.touches.length !== 1 || !accepts(event, event.touches[0])) { reset(); return; }
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY, time: performance.now() };
  };
  const move = (event: TouchEvent) => {
    if (!start) return;
    if (event.touches.length !== 1 || Math.hypot(event.touches[0].clientX - start.x, event.touches[0].clientY - start.y) > movement) reset();
  };
  const end = (event: TouchEvent) => {
    const tap = start; start = null;
    const touch = event.changedTouches[0], now = performance.now();
    if (!tap || !touch || event.touches.length || !accepts(event, touch) || now - tap.time > interval ||
        Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > movement) { previous = null; return; }
    if (previous && now - previous.time <= interval && Math.hypot(touch.clientX - previous.x, touch.clientY - previous.y) <= proximity) {
      previous = null;
      event.preventDefault(); // Only a recognized media double tap suppresses its synthetic click/zoom.
      action();
    } else previous = { x: touch.clientX, y: touch.clientY, time: now };
  };
  // Capture also sees media-area events before native video controls consume
  // propagation. accepts() excludes the controls themselves.
  element.addEventListener('touchstart', begin, { passive: true, capture: true });
  element.addEventListener('touchmove', move, { passive: true, capture: true });
  element.addEventListener('touchend', end, { passive: false, capture: true });
  element.addEventListener('touchcancel', reset, true);
  return () => {
    reset();
    element.removeEventListener('touchstart', begin, true);
    element.removeEventListener('touchmove', move, true);
    element.removeEventListener('touchend', end, true);
    element.removeEventListener('touchcancel', reset, true);
  };
}
