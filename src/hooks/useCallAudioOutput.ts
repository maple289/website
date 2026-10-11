import { useEffect, useState, useSyncExternalStore } from 'react';
import { CallAudioOutput } from '@/lib/callAudioOutput';

export function useCallAudioOutput(callType: 'voice' | 'video') {
  // ActiveCall is keyed by call ID; choice lives only for this call/account.
  const [output] = useState(() => new CallAudioOutput(callType));
  const state = useSyncExternalStore(output.subscribe, output.getSnapshot, output.getSnapshot);
  useEffect(() => { void output.start(); return () => output.stop(); }, [output]);
  return { output, state };
}
