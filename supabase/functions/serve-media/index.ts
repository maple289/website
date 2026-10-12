import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, Range",
  "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
const hash = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), b => b.toString(16).padStart(2, "0")).join("");
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (!["GET", "HEAD"].includes(req.method)) return json({ error: "Method not allowed" }, 405);
  try {
    const url = new URL(req.url), id = url.searchParams.get("id"), capability = url.searchParams.get("playback");
    if (!uuid(id)) return json({ error: "Video id required" }, 400);
    const base = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(base, key, { auth: { persistSession: false } });
    const { data: video, error } = await admin.from("videos").select("id,owner_id,storage_path,processed_storage_path,visibility,mime_type,file_name,processing_status").eq("id", id).maybeSingle();
    if (error || !video) return json({ error: "Video unavailable" }, 404);
    if (capability) {
      if (!/^[a-f0-9]{64}$/.test(capability)) return json({ error: "Video unavailable" }, 404);
      const { data: allowed, error: denied } = await admin.rpc("check_video_playback", { p_hash: await hash(capability), p_video: id });
      if (denied || !allowed) return json({ error: "Video unavailable or access expired" }, 403);
      const path = video.processed_storage_path || video.storage_path;
      if (typeof path !== "string" || !path.startsWith(`${video.owner_id}/`) || path.split("/").some(part => !part || part === "." || part === ".." || part.includes("\\"))) return json({ error: "Video unavailable" }, 404);
      const { data: settings, error: settingsError } = await admin.from("storage_settings").select("videos_base_path").eq("id", 1).maybeSingle();
      if (settingsError) return json({ error: "Video unavailable" }, 503);
      const prefix = (settings?.videos_base_path || '').replace(/^\/+|\/+$/g, '');
      const fullPath = prefix ? `${prefix}/${path}` : path;
      const upstream = await fetch(`${base}/storage/v1/object/authenticated/user-videos/${fullPath.split("/").map(encodeURIComponent).join("/")}`, {
        method: req.method, headers: { Authorization: `Bearer ${key}`, apikey: key, ...(req.headers.has("Range") ? { Range: req.headers.get("Range")! } : {}) }, redirect: "error", signal: req.signal });
      if (!upstream.ok && upstream.status !== 416) return json({ error: "Video unavailable" }, 404);
      const output: Record<string, string> = { ...headers, "Content-Type": video.processed_storage_path ? "video/mp4" : video.mime_type || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(video.file_name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}` };
      for (const name of ["Content-Range", "Accept-Ranges", "Content-Length"]) { const value = upstream.headers.get(name); if (value) output[name] = value; }
      return new Response(upstream.body, { status: upstream.status, headers: output });
    }
    if (req.method === "HEAD") return json({ error: "Playback capability required" }, 400);
    let userId: string | null = null, sessionId: string | null = null;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (token && token !== anon) {
      const client = createClient(base, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
      const { data, error: authError } = await client.auth.getUser(token);
      if (authError || !data.user) return json({ error: "Please sign in again" }, 401);
      // Decode only AFTER Auth verifies the JWT. Never accept a supplied user/session ID.
      const segment = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(atob(segment));
      if (!uuid(claims.session_id)) return json({ error: "Please sign in again" }, 401);
      userId = data.user.id; sessionId = claims.session_id;
    }
    const { data: allowed, error: denied } = await admin.rpc("video_playback_allowed", { p_video: id, p_user: userId, p_session: sessionId });
    if (denied || !allowed) return json({ error: "Video unavailable or access denied" }, 403);
    const { data: withinBudget, error: budgetError } = await admin.rpc('claim_public_request', { p_bucket: 'video-playback', p_seconds: 60, p_limit: 2000 });
    if (budgetError) return json({ error: 'Video playback unavailable' }, 503);
    if (!withinBudget) return json({ error: 'Please retry shortly' }, 429);
    const capabilityToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    const { error: saved } = await admin.from("video_playback_grants").insert({ token_hash: await hash(capabilityToken), video_id: id, user_id: userId, session_id: sessionId });
    if (saved) return json({ error: "Video playback unavailable" }, 503);
    // Internal expiry cleanup, never content deletion.
    await admin.from("video_playback_grants").delete().lt("expires_at", new Date().toISOString());
    const publicOrigin = new URL(Deno.env.get("SUPABASE_PUBLIC_URL") || req.url).origin;
    return json({ url: `${publicOrigin}/functions/v1/serve-media?id=${id}&playback=${capabilityToken}`, file_name: video.file_name,
      mime_type: video.processed_storage_path ? "video/mp4" : video.mime_type });
  } catch { return json({ error: "Video playback unavailable" }, 503); }
});
