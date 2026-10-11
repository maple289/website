import type { Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
// Keep the SDK's existing key so deployed users retain their saved sessions.
export const authStorageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
export const authSessionEvent = 'streamly-auth-session';
const memory = new Map<string, string>();
let memoryOnly = false;
const signOutBarrierPrefix = `${authStorageKey}:signout-pending:`;
let blocked = false;
let revision = 0;
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${authStorageKey}:lifecycle`);

export const sessionRevision = () => revision;
export const sessionIsSignedOut = () => blocked;
function notify() { window.dispatchEvent(new Event(authSessionEvent)); }
export const authStorage = {
  getItem(key: string): string | null {
    if (blocked) return null;
    if (memoryOnly) return memory.get(key) ?? null;
    try {
      const value = localStorage.getItem(key);
      if (value === null) memory.delete(key); else memory.set(key, value);
      return value;
    } catch { memoryOnly = true; return memory.get(key) ?? null; }
  },
  setItem(key: string, value: string) {
    // An old refresh must not restore credentials after explicit sign-out.
    if (blocked) return;
    memory.set(key, value);
    try { localStorage.setItem(key, value); } catch { memoryOnly = true; /* Same-tab session still works without persistent storage. */ }
  },
  removeItem(key: string) {
    memory.delete(key);
    try { localStorage.removeItem(key); } catch { /* In-memory credentials are still removed. */ }
  },
};
export function savedSession(): Session | null {
  try {
    const session = JSON.parse(authStorage.getItem(authStorageKey) || 'null');
    return typeof session?.access_token === 'string' && typeof session?.refresh_token === 'string' && typeof session?.user?.id === 'string' ? session : null;
  } catch { return null; }
}
export function clearLocalSession(broadcast = true) {
  if (!blocked) revision++;
  blocked = true;
  for (const key of [authStorageKey, `${authStorageKey}-user`, `${authStorageKey}-code-verifier`]) authStorage.removeItem(key);
  notify();
  if (broadcast) channel?.postMessage('signed-out');
}
export function enableSessionPersistence() { blocked = false; }
export function announceSignedIn() { channel?.postMessage('signed-in'); }
export function beginSignOutBarrier() {
  const key = `${signOutBarrierPrefix}${Date.now()}-${Math.random()}`;
  const value = String(Date.now() + 13000);
  try { localStorage.setItem(key, value); } catch { /* Same-tab cleanup still provides the barrier. */ }
  return () => {
    try { localStorage.removeItem(key); } catch { /* optional storage */ }
  };
}
export async function waitForSignOutBarrier() {
  const deadline = Date.now() + 13000;
  for (;;) {
    let until = 0;
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(signOutBarrierPrefix)) until = Math.max(until, Number(localStorage.getItem(key)) || 0);
      }
    } catch { return; }
    if (!Number.isFinite(until) || Date.now() >= Math.min(until, deadline)) return;
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
}
if (channel) channel.onmessage = event => {
  if (event.data === 'signed-out') clearLocalSession(false);
  else if (event.data === 'signed-in') { if (blocked) revision++; blocked = false; notify(); }
};
window.addEventListener('storage', event => {
  if (event.key === null) { clearLocalSession(false); return; }
  if (event.key !== authStorageKey) return;
  if (!event.newValue) clearLocalSession(false);
  else {
    try {
      const previous = JSON.parse(event.oldValue || 'null')?.user?.id;
      const next = JSON.parse(event.newValue)?.user?.id;
      if (blocked || previous !== next) revision++;
    } catch { revision++; }
    blocked = false; notify();
  }
});

// Bound auth network work, without changing long-running Storage/RPC requests.
// Preserve SDK locking across tabs; never bypass a held authentication lock.
export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!requestUrl.startsWith(`${url.replace(/\/$/, '')}/auth/v1/`)) return fetch(input, init);
  const generation = revision;
  const controller = new AbortController();
  const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(caller?.reason);
  if (caller?.aborted) abort(); else caller?.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (requestUrl.includes('/token') && generation !== revision) {
      return new Response(JSON.stringify({ code: 'session_not_found', message: 'This session has ended.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } });
    }
    return response;
  } finally { window.clearTimeout(timer); caller?.removeEventListener('abort', abort); }
}
