import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestRegistration: (email: string, password: string) => Promise<{ error: string | null }>;
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
    signUp: async (email, password) => {
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error ? readableError(error.message) : null };
    },
    requestRegistration: async (email, password) => {
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      const { error } = await supabase
        .from('pending_registrations')
        .insert({ email, password });
      if (error) {
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
          return { error: 'A registration request with this email already exists or is pending approval.' };
        }
        return { error: error.message };
      }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-admin-registration`;
      fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email }),
      }).catch((err) => console.warn('Failed to notify admins:', err));

      return { error: null };
    },
    signIn: async (email, password) => {
      if (!isSupabaseConfigured) return { error: 'Authentication is not available right now.' };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? readableError(error.message) : null };
    },
    signOut: async () => {
      if (!isSupabaseConfigured) return;
      await supabase.auth.signOut();
    },
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
