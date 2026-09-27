import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseAnonKey, isSupabaseConfigured } from '@/lib/supabase';
import { accountAction } from '@/lib/accountAuth';

type PasswordSetup = { token: string; identifier: string; expiresAt: number };
const setupStorageKey = 'streamly.initial-password-setup';
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
  requestRegistration: (email: string, firstName?: string, lastName?: string, username?: string) => Promise<{ error: string | null }>;
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
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordSetup, setPasswordSetup] = useState<PasswordSetup | null>(readPasswordSetup);

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

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      listener.subscription.unsubscribe();
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
      if (!passwordSetup) return { error: 'Sign in again to start password setup.' };
      try {
        await accountAction({ action: 'set-password', setup_token: passwordSetup.token, new_password: password, confirm_password: confirmation });
        const result = await accountAction({ action: 'login', identifier: passwordSetup.identifier, password });
        if (!result.session) return { error: 'Your password was saved. Return to sign in and use your new password.' };
        const { error } = await supabase.auth.setSession(result.session);
        if (error) return { error: 'Your password was saved. Return to sign in and use your new password.' };
        setPasswordSetup(null);
        window.location.hash = '#/library';
        return { error: null };
      } catch (error) { return { error: error instanceof Error ? error.message : 'Could not complete password setup. Please try signing in again.' }; }
    },
    signUp: async (email, password) => {
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error ? readableError(error.message) : null };
    },
    requestRegistration: async (email, firstName = '', lastName = '', username = '') => {
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-admin-registration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
          body: JSON.stringify({ email, username: username.trim(), first_name: firstName.trim() || null, last_name: lastName.trim() || null }),
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
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      try {
        const result = await accountAction({ action: 'login', identifier: email, password });
        if (result.requires_password_setup && result.setup_token) {
          setPasswordSetup({ token: result.setup_token, identifier: email, expiresAt: Date.now() + (result.expires_in ?? 900) * 1000 });
          window.location.hash = '#/setup-password';
          return { error: null };
        }
        if (!result.session) return { error: 'Could not start your session. Please try again.' };
        const { error } = await supabase.auth.setSession(result.session);
        if (!error) setPasswordSetup(null);
        return { error: error ? readableError(error.message) : null };
      } catch (error) { return { error: error instanceof Error ? error.message : 'Could not sign in. Please try again.' }; }
    },
    signOut: async () => {
      setPasswordSetup(null);
      if (!isSupabaseConfigured) return;
      await supabase.auth.signOut();
    },
  }), [session, loading, passwordSetup]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
