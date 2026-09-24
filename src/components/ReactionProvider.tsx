import { useEffect, useMemo, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ReactionContext, ReactionStore } from '@/lib/reactions';

export function ReactionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const store = useMemo(() => new ReactionStore(user?.id ?? null), [user?.id]);
  useEffect(() => { store.start(); return () => store.stop(); }, [store]);
  return <ReactionContext.Provider value={store}>{children}</ReactionContext.Provider>;
}
