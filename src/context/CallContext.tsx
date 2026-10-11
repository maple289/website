import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { CallEngine, emptyCallState, type CallState } from '@/lib/callEngine';

type Calls = { state: CallState; engine: CallEngine | null };
const CallContext = createContext<Calls>({ state: emptyCallState, engine: null });
// eslint-disable-next-line react-refresh/only-export-components
export const useCalls = () => useContext(CallContext);

export function CallProvider({ children }: { children: ReactNode }) {
  const { user, session, passwordSetup, configured } = useAuth();
  const active = !!user && !!session && !passwordSetup && configured;
  const [snapshot, setSnapshot] = useState<{ owner: string; value: Calls } | null>(null);
  return <CallContext.Provider value={active && snapshot?.owner === user?.id ? snapshot.value : { state: emptyCallState, engine: null }}>
    <CallSession key={active ? user.id : 'guest'} userId={active ? user.id : ''} publish={setSnapshot} />
    {children}
  </CallContext.Provider>;
}
function CallSession({ userId, publish }: { userId: string; publish: (snapshot: { owner: string; value: Calls }) => void }) {
  useEffect(() => {
    if (!userId) return;
    // Construct inside the effect so StrictMode cleanup cannot reuse a disposed engine.
    const engine = new CallEngine(userId, state => publish({ owner: userId, value: { state, engine } }));
    publish({ owner: userId, value: { state: engine.state, engine } });
    return () => engine.dispose();
  }, [userId, publish]);
  return null;
}
