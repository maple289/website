import { supabase, supabaseAnonKey } from './supabase';
import { temporarySharePath } from './temporaryShareRouting';
export type ShareTarget = { type: 'video' | 'photo' | 'file' | 'folder'; id: string; name: string };
export type TemporaryLink = { id: string; expires_at: string; url?: string };
export const temporaryShareEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/temporary-share`;
export async function createTemporaryLink(target: ShareTarget, previous?: string): Promise<TemporaryLink> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again.');
  const response = await fetch(temporaryShareEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ type: target.type, id: target.id, previous }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not create the link.');
  return { ...result, url: new URL(temporarySharePath(result.token, import.meta.env.BASE_URL), window.location.origin).href };
}
export async function getTemporaryLink(target: ShareTarget): Promise<TemporaryLink | null> {
  const { data, error } = await supabase.rpc('get_temporary_share', { p_type: target.type, p_content: target.id });
  if (error) throw error;
  return data;
}
export async function revokeTemporaryLink(id: string) {
  const { error } = await supabase.rpc('revoke_temporary_share', { p_id: id });
  if (error) throw error;
}
