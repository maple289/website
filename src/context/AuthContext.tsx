import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseAnonKey, isSupabaseConfigured } from '@/lib/supabase';
import { accountAction } from '@/lib/accountAuth';
import { touchActivity } from '@/lib/analytics';
import { installSession, prepareSignIn, signOutSession } from '@/lib/authSession';
import { authSessionEvent, savedSession, sessionIsSignedOut, sessionRevision } from '@/lib/authSessionStorage';

type PasswordSetup = { token: string; identifier: string; expiresAt: number };
const setupStorageKey = 'streamly.initial-password-setup';
function clearSavedPasswordSetup() {
  try { sessionStorage.removeItem(setupStorageKey); } catch { /* optional storage */ }
}
function readPasswordSetup(): PasswordSetup | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(setupStorageKey) || 'null');
    return saved && /^[a-f0-9]{64}$/.test(saved.token) && typeof saved.identifier === 'string' && saved.expiresAt > Date.now() ? saved : null;
  } catch { return null; }
}

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestRegistration: (email: string, firstName?: string, lastName?: string) => Promise<{ error: string | null }>;
  passwordSetup: PasswordSetup | null;
  cancelPasswordSetup: () => void;
  completeInitialPassword: (password: string, confirmation: string) => Promise<{ error: string | null }>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const readableError = (message: string): string => {
  if (message.includes('User already registered')) return 'An account with this email already exists.';
  if (message.includes('Invalid login credentials')) return 'Email or password is incorrect.';
  if (message.includes('Password should be at least')) return 'Password must be at least 6 characters.';
  return message;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(savedSession);
  const [loading, setLoading] = useState(true);
  const [passwordSetup, setPasswordSetup] = useState<PasswordSetup | null>(readPasswordSetup);

  useEffect(() => {
    if (!session?.user.id) return;
    let last = 0;
    const active = () => {
      if (document.hidden || Date.now() - last < 5 * 60 * 1000) return;
      last = Date.now(); touchActivity();
    };
    active();
    window.addEventListener('pointerdown', active, { passive: true });
    window.addEventListener('keydown', active);
    window.addEventListener('hashchange', active);
    return () => { window.removeEventListener('pointerdown', active); window.removeEventListener('keydown', active); window.removeEventListener('hashchange', active); };
  }, [session?.user.id]);

  useEffect(() => {
    try {
      if (passwordSetup) sessionStorage.setItem(setupStorageKey, JSON.stringify(passwordSetup));
      else sessionStorage.removeItem(setupStorageKey);
    } catch { /* Storage may be unavailable; the in-memory setup session still works. */ }
  }, [passwordSetup]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let alive = true, version = 0, recovering = false;
    // Subscribe first; an older initialization read must never overwrite a
    // refresh, account switch, or explicit sign-out observed in the meantime.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!alive) return;
      version++;
      setSession(sessionIsSignedOut() ? null : newSession);
      setLoading(false);
    });
    const recover = async () => {
      if (recovering || document.hidden || sessionIsSignedOut()) return;
      recovering = true;
      const current = version;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (alive && current === version && !sessionIsSignedOut() && !error) setSession(data.session);
      } catch { /* Network recovery may fail; SDK auth events still invalidate rejected sessions. */ }
      finally {
        recovering = false;
        if (alive) {
          setLoading(false);
          if (current !== version && !sessionIsSignedOut()) void recover();
        }
      }
    };
    const sync = () => {
      version++;
      if (sessionIsSignedOut()) { clearSavedPasswordSetup(); setSession(null); setPasswordSetup(null); setLoading(false); }
      else { setSession(savedSession()); setLoading(false); void recover(); }
    };
    const resume = () => { void recover(); };
    window.addEventListener(authSessionEvent, sync);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    if (sessionIsSignedOut()) setLoading(false);
    void recover();

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
      window.removeEventListener(authSessionEvent, sync);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    configured: isSupabaseConfigured,
    passwordSetup,
    cancelPasswordSetup: () => setPasswordSetup(null),
    completeInitialPassword: async (password, confirmation) => {
      const revision = sessionRevision();
      if (!passwordSetup) return { error: 'Sign in again to start password setup.' };
      try {
        await prepareSignIn(revision);
        await accountAction({ action: 'set-password', setup_token: passwordSetup.token, new_password: password, confirm_password: confirmation });
        if (revision !== sessionRevision()) throw new Error('This session has ended. Please sign in again.');
        const result = await accountAction({ action: 'login', identifier: passwordSetup.identifier, password });
        if (!result.session) return { error: 'Your password was saved. Return to sign in and use your new password.' };
        const { error } = await installSession(result.session, revision);
        if (error) return { error: 'Your password was saved. Return to sign in and use your new password.' };
        setPasswordSetup(null);
        window.location.hash = '';
        return { error: null };
      } catch (error) { return { error: error instanceof Error ? error.message : 'Could not complete password setup. Please try signing in again.' }; }
    },
    signUp: async (email, password) => {
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      const revision = sessionRevision();
      try {
        await prepareSignIn(revision);
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return { error: readableError(error.message) };
        if (data.session) {
          const installed = await installSession(data.session, revision);
          if (installed.error) return { error: readableError(installed.error.message) };
        }
        return { error: null };
      } catch { return { error: 'Could not register right now. Please try again.' }; }
    },
    requestRegistration: async (email, firstName = '', lastName = '') => {
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-admin-registration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
          body: JSON.stringify({ email: email.trim().toLowerCase(), first_name: firstName.trim() || null, last_name: lastName.trim() || null }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          return { error: data.error || 'We could not submit your request right now. Please try again.' };
        }
      } catch {
        return { error: 'We could not confirm your request. Please try again; duplicate requests will not create another account.' };
      }

      return { error: null };
    },
    signIn: async (email, password) => {
      const revision = sessionRevision();
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      try {
        await prepareSignIn(revision);
        const result = await accountAction({ action: 'login', identifier: email, password });
        if (revision !== sessionRevision()) throw new Error('Sign-in was cancelled. Please try again.');
        if (result.requires_password_setup && result.setup_token) {
          setPasswordSetup({ token: result.setup_token, identifier: email, expiresAt: Date.now() + (result.expires_in ?? 900) * 1000 });
          window.location.hash = '#/setup-password';
          return { error: null };
        }
        if (!result.session) return { error: 'Could not start your session. Please try again.' };
        const { error } = await installSession(result.session, revision);
        if (!error) {
          setPasswordSetup(null);
          window.location.hash = '';
        }
        return { error: error ? readableError(error.message) : null };
      } catch (error) { return { error: error instanceof Error ? error.message : 'Could not sign in. Please try again.' }; }
    },
    signOut: async () => {
      clearSavedPasswordSetup();
      setPasswordSetup(null);
      signOutSession();
    },
  }), [session, loading, passwordSetup]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
