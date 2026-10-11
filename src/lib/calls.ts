import { supabase } from '@/lib/supabase';
import { authenticatedFetch, authenticatedRequest } from '@/lib/authSession';
import { ChatRequestError } from '@/lib/messenger';
export type CallMember = { id: string; name: string; state: 'invited' | 'joined' | 'declined' | 'left' | 'missed' };
export type CallInfo = { id: string; conversation_id: string; caller_id: string; caller_name: string; name: string;
  media: 'voice' | 'video'; state: 'ringing' | 'active' | 'ended'; outcome: string | null;
  started_at: string; answered_at: string | null; ended_at: string | null; duration: number;
  my_state: CallMember['state'] | null; mine: boolean; seen: boolean; members: CallMember[] };
export type CallSignal = { id: number; sender_id: string; kind: 'offer' | 'answer' | 'candidate'; payload: RTCSessionDescriptionInit | RTCIceCandidateInit };
export type RelayConfig = { iceServers: RTCIceServer[]; expiresAt: number };
export async function callRequest<T>(action: string, call: string | null = null, data: Record<string, unknown> = {}): Promise<T> {
  const { data: result, error } = await authenticatedRequest(() => supabase.rpc('messenger_calls_rpc', { p_action: action, p_call: call, p_data: data }));
  if (error) throw new ChatRequestError(error.code === 'P0001' || error.code === '42501' ? error.message : 'The call could not be updated. Please try again.', !error.code, error.code);
  return result as T;
}
export function callRelay(): Promise<{ configured: boolean; maxParticipants: number }>;
export function callRelay(call: string, session: string): Promise<RelayConfig>;
export async function callRelay(call?: string, session?: string): Promise<RelayConfig | { configured: boolean; maxParticipants: number }> {
  const response = await authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/messenger-calls`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(call ? { action: 'credentials', call_id: call, session_id: session } : { action: 'configuration' }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error('Calling could not verify your session. Please retry the call.');
  if (!response.ok) throw new Error(data.message || 'The call relay is unavailable.');
  return data;
}
