import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const hash = async (token: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const text = await req.text();
    if (text.length > 8192) return json({ error: "Request too large" }, 413);
    const body = JSON.parse(text);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const options = { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } };
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", options);
    const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", options);

    if (body.action === "set-password") {
      if (typeof body.setup_token !== "string" || !/^[a-f0-9]{64}$/.test(body.setup_token)) return json({ error: "Password setup has expired. Sign in again." }, 401);
      if (typeof body.new_password !== "string" || !body.new_password.trim() || body.new_password.length < 6 || body.new_password.length > 1024) return json({ error: "New password must contain at least 6 characters." }, 400);
      if (body.new_password !== body.confirm_password) return json({ error: "New password and confirmation do not match." }, 400);
      const tokenHash = await hash(body.setup_token);
      const { data: accountId, error: claimError } = await service.rpc("claim_initial_password", { p_token_hash: tokenHash });
      if (claimError) return json({ error: "Password setup is temporarily unavailable." }, 503);
      if (!accountId) return json({ error: "Password setup has expired or was already completed. Sign in again." }, 401);
      // Account ID comes ONLY from the server-side capability. Browser-supplied
      // user IDs, roles, usernames and emails are deliberately never forwarded.
      const { error: updateError } = await service.auth.admin.updateUserById(accountId, { password: body.new_password });
      if (updateError) {
        // Do not reopen a claim following an ambiguous timeout/server error.
        if (updateError.status && updateError.status >= 400 && updateError.status < 500) {
          await service.rpc("release_initial_password", { p_token_hash: tokenHash });
        }
        return json({ error: updateError.code === "weak_password" ? "New password does not meet the password-security requirements." : "Could not complete password setup. Try signing in again before retrying." }, 400);
      }
      const { data: activation, error: verifyError } = await service.from("account_activation").select("must_change_password,password_set_at").eq("user_id", accountId).single();
      if (verifyError || !activation || activation.must_change_password || !activation.password_set_at) return json({ error: "Could not confirm password setup. Please sign in again." }, 503);
      // No password/token is logged or returned. Normal Auth sign-in happens
      // after setup; a failed network response cannot undo an established hash.
      return json({ success: true, must_change_password: false });
    }

    if (body.action !== "login" || typeof body.identifier !== "string" || !body.identifier.trim() || body.identifier.length > 254 || typeof body.password !== "string" || body.password.length > 1024) return json({ error: "Enter your username or email and password." }, 400);
    const identifier = body.identifier.trim();
    if (body.password === "") {
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const { data: allowed, error } = await service.rpc("start_initial_login", { p_identifier: identifier, p_token_hash: await hash(token) });
      if (error) return json({ error: "Sign-in is temporarily unavailable." }, 503);
      if (!allowed) return json({ error: "Unable to sign in. Check your credentials and approval status." }, 401);
      return json({ requires_password_setup: true, setup_token: token, expires_in: 900 });
    }
    const { data: email, error } = await service.rpc("resolve_login_email", { p_identifier: identifier });
    if (error) return json({ error: "Sign-in is temporarily unavailable." }, 503);
    // Still invoke Auth for unknown identifiers, retaining its rate limiting and
    // credential verification rather than exposing a public username lookup.
    const { data, error: loginError } = await auth.auth.signInWithPassword({ email: email || "unknown-account@invalid.example", password: body.password });
    if (loginError || !data.session || !email) return json({ error: "Username/email or password is incorrect." }, loginError?.status === 429 ? 429 : 401);
    return json({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
  } catch {
    // Never include request bodies, credentials, or provider errors in logs.
    return json({ error: "Could not complete the request. Please try again." }, 400);
  }
});
