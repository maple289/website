import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, "Content-Type": "application/json" } });
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const ttl = 3600;
function relayConfiguration() {
  const secret = Deno.env.get("TURN_SHARED_SECRET") ?? "";
  const urls = (Deno.env.get("TURN_URLS") ?? "").split(",").map(v => v.trim()).filter(Boolean);
  const stun = (Deno.env.get("STUN_URLS") ?? "").split(",").map(v => v.trim()).filter(Boolean);
  // Fail closed at preflight as well as issuance. Do not accept HTTP URLs,
  // embedded credentials, missing hosts or out-of-range ports.
  const valid = (value: string, isTurn: boolean) => {
    const match = value.match(isTurn
      ? /^turns?:([a-z0-9.-]+|\[[0-9a-f:]+\])(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/i
      : /^stuns?:([a-z0-9.-]+|\[[0-9a-f:]+\])(?::([0-9]{1,5}))?$/i);
    if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return false;
    return match[1].startsWith("[") || match[1].split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  };
  if (!secret.trim() || !urls.length || urls.some(v => !valid(v, true)) || stun.some(v => !valid(v, false))) return null;
  return { secret, urls, stun };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ message: "Method not allowed." }, 405);
  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ message: "Please sign in." }, 401);
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: { user }, error } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (error || !user) return json({ message: "Please sign in." }, 401);
    const { data: active, error: denied } = await client.rpc("messenger_active", { p_user: user.id });
    if (denied || !active) return json({ message: "An active account is required." }, 403);
    if (Number(req.headers.get("content-length") ?? 0) > 2048) return json({ message: "Request too large." }, 413);
    const raw = await req.text();
    if (raw.length > 2048) return json({ message: "Request too large." }, 413);
    const body = JSON.parse(raw);
    const relay = relayConfiguration();
    if (!relay) return json({ message: "Calling is not configured yet. Ask an administrator to configure the local TURN service." }, 503);
    // Preflight never releases relay credentials or creates/rings a call.
    if (body.action === "configuration") return json({ configured: true, maxParticipants: 4 });
    if (body.action !== "credentials" || !uuid(body.call_id) || !uuid(body.session_id)) return json({ message: "Invalid call request." }, 400);
    const { error: access } = await client.rpc("messenger_calls_rpc", { p_action: "relay-reserve", p_call: body.call_id, p_data: { session_id: body.session_id } });
    if (access) return access.code === "P0001"
      ? json({ message: "Please wait 30 seconds before retrying relay credentials." }, 429)
      : json({ message: "Call unavailable or access denied." }, 403);
    const username = `${Math.floor(Date.now() / 1000) + ttl}:${user.id}`;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(relay.secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username)));
    const credential = btoa(String.fromCharCode(...signature));
    const iceServers = [...(relay.stun.length ? [{ urls: relay.stun }] : []), { urls: relay.urls, username, credential }];
    // Recheck after signing in case the call ended or access changed.
    const { error: revoked } = await client.rpc("messenger_calls_rpc", { p_action: "credentials", p_call: body.call_id, p_data: { session_id: body.session_id } });
    if (revoked) return json({ message: "This call has ended." }, 403);
    return json({ iceServers, expiresAt: Date.now() + ttl * 1000 });
  } catch {
    console.error(JSON.stringify({ operation: "messenger_turn_credentials", category: "configuration_or_credential_error" }));
    return json({ message: "Calling could not be configured. Please try again or contact an administrator." }, 503);
  }
});
