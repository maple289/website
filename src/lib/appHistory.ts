// Index existing entries rather than adding sentinel entries. A blocked traversal
// returns to its origin before prompting; Discard replays the original delta once.
const marker = 'streamlyHistoryIndex';
type Guard = { blocked: () => boolean; confirm: () => Promise<boolean> };
let index = 0;
let installed = false;
let traversalUrl = '';
let guard: Guard | null = null;
let allowNext = false;
let pending: { origin: number; target: number; restored: boolean; decision?: boolean; asked: boolean } | null = null;
const suppressedHashes = new Set<string>();
const stateWithIndex = (state: unknown, value: number) => ({ ...(state && typeof state === 'object' ? state : {}), [marker]: value });
const readIndex = () => {
  const value = window.history.state?.[marker];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
};

export function initializeAppHistory() {
  if (installed) return;
  installed = true;
  index = readIndex() ?? 0;
  traversalUrl = window.location.href;
  window.history.replaceState(stateWithIndex(window.history.state, index), '');
  const finish = () => {
    if (!pending || !pending.restored || pending.decision === undefined) return;
    const request = pending;
    pending = null;
    if (request.decision) {
      allowNext = true;
      window.history.go(request.target - request.origin);
    }
  };
  window.addEventListener('popstate', (event) => {
    const hashChanged = new URL(traversalUrl).hash !== window.location.hash;
    traversalUrl = window.location.href;
    // Native fragment links create an entry with no application state.
    const target = readIndex() ?? index + 1;
    if (readIndex() === null) window.history.replaceState(stateWithIndex(window.history.state, target), '');
    if (allowNext) { allowNext = false; index = target; return; }
    if (!pending && (!guard?.blocked() || target === index)) { index = target; return; }
    event.stopImmediatePropagation();
    if (hashChanged) suppressedHashes.add(window.location.href);
    if (!pending) pending = { origin: index, target, restored: false, asked: false };
    const request = pending;
    request.restored = target === request.origin;
    if (!request.restored) { window.history.go(request.origin - target); return; }
    if (!request.asked) {
      request.asked = true;
      void (guard?.confirm() ?? Promise.resolve(false)).then((accepted) => {
        if (pending !== request) return;
        request.decision = accepted;
        finish();
      }, () => { if (pending === request) { request.decision = false; finish(); } });
    }
    finish();
  }, true);
  window.addEventListener('hashchange', (event) => {
    if (suppressedHashes.delete(event.newURL) || pending) {
      event.stopImmediatePropagation();
      return;
    }
    // Some browsers emit hashchange without popstate for a new fragment.
    if (readIndex() === null) {
      index++;
      window.history.replaceState(stateWithIndex(window.history.state, index), '');
    } else index = readIndex()!;
  }, true);
}

export function pushAppHistory(state: unknown, url: string) {
  initializeAppHistory();
  window.history.pushState(stateWithIndex(state, ++index), '', url);
  traversalUrl = window.location.href;
}

export function replaceAppHistory(state: unknown, url: string) {
  initializeAppHistory();
  window.history.replaceState(stateWithIndex(state, index), '', url);
  traversalUrl = window.location.href;
}

export function registerNavigationGuard(next: Guard) {
  initializeAppHistory();
  guard = next;
  return () => { if (guard === next) guard = null; };
}

export function goBackAfterConfirmation() {
  // This bypass applies to precisely one traversal, not subsequent Forward/Back.
  if (window.history.length <= 1) return;
  allowNext = true;
  window.history.back();
}
