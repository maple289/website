import { supabaseAnonKey } from './supabase';

export async function accountAction(body: Record<string, string>) {
  const endpoint = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/account-login`);
  const local = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((endpoint.protocol !== 'https:' && !local(endpoint)) || (location.protocol !== 'https:' && !local(new URL(location.href)))) {
    throw new Error('Use a secure HTTPS connection to sign in.');
  }
  const response = await fetch(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not complete the request. Please try again.');
  return data as { requires_password_setup?: boolean; setup_token?: string; expires_in?: number; success?: boolean; session?: { access_token: string; refresh_token: string } };
}
