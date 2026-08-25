import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export function useAdmin() {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setIsAdmin(false);
      setChecking(false);
      return;
    }

    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc('is_admin');
      if (active) {
        if (!error && data === true) setIsAdmin(true);
        setChecking(false);
      }
    })();

    return () => { active = false; };
  }, [user, loading]);

  return { isAdmin, checking: loading || checking };
}
