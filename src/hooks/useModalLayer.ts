import { useLayoutEffect, type RefObject } from 'react';

const layers: HTMLElement[] = [];
const locks = new Map<HTMLElement, { count: number; inert: boolean }>();
let scrollBefore = '';
let htmlScrollBefore = '';
const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function useModalLayer(ref: RefObject<HTMLElement>, enabled = true) {
  useLayoutEffect(() => {
    const layer = ref.current;
    if (!enabled || !layer) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!layers.length) { scrollBefore = document.body.style.overflow; htmlScrollBefore = document.documentElement.style.overflow; document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden'; }
    layers.push(layer);
    const blocked: HTMLElement[] = [];
    let branch: HTMLElement = layer;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
        const lock = locks.get(sibling) ?? { count: 0, inert: sibling.hasAttribute('inert') };
        lock.count++; locks.set(sibling, lock); sibling.setAttribute('inert', ''); blocked.push(sibling);
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    const top = () => layers[layers.length - 1] === layer;
    const controls = () => Array.from(layer.querySelectorAll<HTMLElement>(focusable)).filter((node) => !node.closest('[inert], [aria-hidden="true"], [hidden]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const focus = () => (layer.hasAttribute('data-focus-viewer') ? layer : controls()[0] ?? layer).focus({ preventScroll: true });
    if (!layer.contains(document.activeElement)) focus();
    const keyboard = (event: KeyboardEvent) => {
      if (!top()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (event.key !== 'Tab') return;
      const elements = controls(), first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); layer.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === layer)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const containFocus = (event: FocusEvent) => { if (top() && event.target instanceof Node && !layer.contains(event.target)) focus(); };
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('focusin', containFocus, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true); document.removeEventListener('focusin', containFocus, true);
      const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1);
      for (const sibling of blocked) {
        const lock = locks.get(sibling);
        if (lock && --lock.count === 0) { if (!lock.inert) sibling.removeAttribute('inert'); locks.delete(sibling); }
      }
      if (!layers.length) { document.body.style.overflow = scrollBefore; document.documentElement.style.overflow = htmlScrollBefore; }
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, [ref, enabled]);
}
