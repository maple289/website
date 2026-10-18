import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseAnonKey } from './supabase';
import { detachNotificationDevice } from './notifications';
import { announceSignedIn, beginSignOutBarrier, clearLocalSession, enableSessionPersistence, savedSession, sessionIsSignedOut, sessionRevision, waitForSignOutBarrier } from './authSessionStorage';

let cleanup: Promise<void> = Promise.resolve();
let refresh: Promise<Session> | null = null;
export async function prepareSignIn(revision: number) {
  await cleanup;
  await waitForSignOutBarrier();
  if (revision !== sessionRevision()) throw new Error('Sign-in was cancelled. Please try again.');
}
export async function installSession(tokens: { access_token: string; refresh_token: string }, revision: number) {
  // Drain any old refresh/sign-out before allowing a new login to save tokens.
  await prepareSignIn(revision);
  enableSessionPersistence();
  const result = await supabase.auth.setSession(tokens);
  if (revision !== sessionRevision()) throw new Error('Sign-in was cancelled. Please try again.');
  if (!result.error) announceSignedIn();
  return result;
}
export function signOutSession() {
  const session = savedSession();
  // Revoke this browser's push binding using the same captured session as logout.
  const pushCleanup = detachNotificationDevice(session?.access_token, session?.user.id);
  const releaseBarrier = beginSignOutBarrier();
  clearLocalSession();
  refresh = null;
  const localCleanup = supabase.auth.signOut({ scope: 'local' }).then(() => undefined, () => undefined);
  // Local sign-out is immediate and durable. Preserve the existing global
  // revocation attempt, but server/network failure cannot keep this device in.
  const revocation = session?.access_token ? fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/logout?scope=global`, {
    method: 'POST', headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(12000),
  }).catch(() => undefined) : Promise.resolve();
  // A delayed global logout must finish before a new login can be installed,
  // otherwise it could revoke the newly created session too.
  void revocation.finally(releaseBarrier).catch(() => undefined);
  cleanup = Promise.all([localCleanup, revocation, pushCleanup]).then(() => undefined);
}
async function activeSession(): Promise<Session> {
  if (sessionIsSignedOut()) throw new Error('Please sign in again.');
  const revision = sessionRevision();
  const { data, error } = await supabase.auth.getSession();
  if (sessionIsSignedOut() || revision !== sessionRevision()) throw new Error('This session has ended. Please sign in again.');
  if (error) throw new Error('Could not reconnect your session. Check your connection and try again.');
  if (!data.session) throw new Error('Please sign in again.');
  return data.session;
}
async function refreshRejectedSession(rejected: Session): Promise<Session> {
  const current = await activeSession();
  if (current.user.id !== rejected.user.id) throw new Error('The signed-in account changed. Please try again.');
  if (current.access_token !== rejected.access_token) return current;
  if (!refresh) {
    const revision = sessionRevision();
    const operation = supabase.auth.refreshSession().then(({ data, error }) => {
      if (sessionIsSignedOut() || revision !== sessionRevision()) throw new Error('This session has ended. Please sign in again.');
      if (error || !data.session) throw new Error('Could not reconnect your session. Check your connection and try again.');
      return data.session;
    });
    refresh = operation;
    void operation.finally(() => { if (refresh === operation) refresh = null; }).catch(() => undefined);
  }
  return refresh;
}
// Retry only a rejected authentication request, once. Never retry uncertain
// mutations, permission denials (403), or requests after an account switch.
export async function authenticatedRequest<Result extends { status: number }>(send: () => PromiseLike<Result>): Promise<Result> {
  const revision = sessionRevision();
  const session = await activeSession();
  const result = await send();
  if (result.status !== 401) return result;
  await refreshRejectedSession(session);
  if (sessionIsSignedOut() || revision !== sessionRevision()) throw new Error('This session has ended. Please sign in again.');
  return send();
}
export async function authenticatedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const revision = sessionRevision();
  const session = await activeSession();
  const send = (token: string) => {
    init.signal?.throwIfAborted();
    if (sessionIsSignedOut() || revision !== sessionRevision()) throw new Error('This session has ended. Please sign in again.');
    const headers = new Headers(init.headers);
    headers.set('apikey', supabaseAnonKey); headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const response = await send(session.access_token);
  if (response.status !== 401) return response;
  const renewed = await refreshRejectedSession(session);
  return send(renewed.access_token);
}
