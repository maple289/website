import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export function useAdmin() {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  const checkAdmin = useCallback(async () => {
    if (!user) {
      setIsAdmin(false);
      setChecking(false);
      return;
    }
    const { data, error } = await supabase.rpc('is_admin');
    if (!error && data === true) {
      setIsAdmin(true);
    } else {
      setIsAdmin(false);
    }
    setChecking(false);
  }, [user]);

  useEffect(() => {
    if (loading) return;
    checkAdmin();
  }, [loading, checkAdmin]);

  const refreshAdmin = useCallback(() => {
    setChecking(true);
    checkAdmin();
  }, [checkAdmin]);

  return { isAdmin, checking: loading || checking, refreshAdmin };
}
