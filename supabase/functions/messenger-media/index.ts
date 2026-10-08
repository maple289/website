import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { previewFormats } from "../_shared/previewFormats.ts";

const headers = {
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, "Content-Type": "application/json" } });
const unavailable = () => json({ status: "failed", message: "Attachment unavailable or access denied." }, 404);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (!['GET', 'POST'].includes(req.method)) return json({ message: "Method not allowed" }, 405);
  const base = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ message: "Please sign in." }, 401);
  const client = createClient(base, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const service = createClient(base, key, { auth: { persistSession: false } });
  try {
    const { data: { user }, error: authError } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (authError || !user) return json({ message: "Please sign in." }, 401);
    const { data: active, error: activeError } = await client.rpc("messenger_active", { p_user: user.id });
    if (activeError || !active) return json({ message: "An active account is required." }, 403);
    if (req.method === "POST") {
      if (Number(req.headers.get('content-length') ?? 0) > 16384) return json({ message: "Request too large" }, 413);
      const raw = await req.text();
      if (raw.length > 16384) return json({ message: "Request too large" }, 413);
      const body = JSON.parse(raw);
      if (!uuid(body.conversation_id)) return json({ message: "Conversation unavailable." }, 404);
      if (body.action === "typing") {
        if (!uuid(body.session_id)) return json({ message: "Invalid session" }, 400);
        const { data: targets, error } = await client.rpc("messenger_rpc", { p_action: "typing-targets", p_conversation: body.conversation_id,
          p_data: { session_id: body.session_id, typing: body.typing === true } });
        if (error) return json({ message: "Conversation unavailable." }, 403);
        if (targets?.length) {
          const broadcast = await fetch(`${base}/realtime/v1/api/broadcast`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messages: targets.map((id: string) => ({ topic: `messenger:user:${id}`, event: "typing", private: true,
              payload: { conversation_id: body.conversation_id, user_id: user.id, typing: body.typing === true, expires_at: Date.now() + 6000 } })) }) });
          if (!broadcast.ok) console.error(JSON.stringify({ operation: "messenger_typing", status: broadcast.status }));
        }
        return json({ ok: true });
      }
      if (body.action !== "delete" || !uuid(body.id)) return json({ message: "Invalid operation" }, 400);
      const { data: plan, error: planError } = await client.rpc("messenger_rpc", { p_action: "delete-plan", p_conversation: body.conversation_id, p_data: { id: body.id } });
      if (planError) return json({ message: "Message unavailable or you cannot delete it." }, 403);
      // A deletion can be retried after partial cleanup or a lost HTTP response.
      // Database rows remain until Storage confirms removal. The RPC checks the
      // current membership and message author again before finalizing.
      for (const item of plan ?? []) {
        const { error } = await service.storage.from("messenger-attachments").remove([item.path]);
        if (error) {
          console.error(JSON.stringify({ operation: "messenger_delete_attachment", id: body.id, type: error.name }));
          return json({ message: "Deletion is incomplete. Some attachments may already be removed. Retry to finish deleting this message." }, 503);
        }
        if (item.previews?.length) {
          const { error: previewError } = await service.storage.from("file-previews").remove(item.previews);
          if (previewError) {
            console.error(JSON.stringify({ operation: "messenger_delete_preview", id: body.id, type: previewError.name }));
            return json({ message: "Attachment cleanup is incomplete. Retry to finish deleting this message." }, 503);
          }
        }
      }
      const { error } = await client.rpc("messenger_rpc", { p_action: "delete-message", p_conversation: body.conversation_id, p_data: { id: body.id } });
      if (error) {
        console.error(JSON.stringify({ operation: "messenger_delete_record", id: body.id, code: error.code }));
        return json({ message: "Deletion is incomplete. Retry to finish deleting this message." }, 503);
      }
      return json({ ok: true });
    }
    const params = new URL(req.url).searchParams, id = params.get("id");
    if (!uuid(id)) return unavailable();
    const { data: source, error } = await client.rpc("messenger_attachment", { p_id: id });
    if (error || !source) return unavailable();
    const download = params.get("download") === "1", video = params.get("video") === "1";
    const extension = source.name.split('.').pop()?.toLowerCase() ?? '', type = previewFormats[extension];
    let bucket = "messenger-attachments", path = source.path, mime = "application/octet-stream", maximum = 100 * 1048576;
    if (!download && !video) {
      if (!type) return json({ status: "unsupported", message: "Preview is not available. You can download the original file." });
      const [kind, previewMime, limit] = type;
      mime = previewMime; maximum = limit;
      if (source.size > maximum) return json({ status: "failed", message: `This file exceeds the ${maximum / 1048576} MB preview limit. You can still download it.` });
      if (kind === "office") {
        const { data: job, error: jobError } = await service.rpc("queue_file_preview", { p_source_id: source.id, p_version: source.version, p_extension: extension });
        if (jobError || !job) {
          console.error(JSON.stringify({ operation: "messenger_queue_preview", id, code: jobError?.code }));
          return json({ status: "failed", message: "Preview could not be queued. You can still download the original file." }, 503);
        }
        if (job.status === "failed") return json({ status: "failed", message: "Preview could not be generated. You can still download the original file." });
        if (job.status !== "ready") return json({ status: "generating", queued: job.status === "queued" }, 202);
        bucket = "file-previews"; path = job.preview_path; maximum = 50 * 1048576;
      }
      if (params.get("content") !== "1") return json({ status: "available", kind: kind === "office" ? "pdf" : kind, mime });
    } else if (video) {
      if (!source.mime.startsWith('video/')) return unavailable();
      // Codec compatibility is left to the browser; never run library FFmpeg jobs
      // or promote a Messenger attachment to public media.
      mime = source.mime;
    }
    const upstream = await fetch(`${base}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, redirect: "error", signal: req.signal,
    });
    if (!upstream.ok || Number(upstream.headers.get('content-length') || 0) > maximum) return unavailable();
    // Recheck immediately before delivering bytes in case membership was revoked
    // while the private cache/source was being resolved.
    const { error: recheck } = await client.rpc("messenger_attachment", { p_id: id });
    if (recheck) { await upstream.body?.cancel(); return unavailable(); }
    return new Response(upstream.body, { headers: { ...headers, "Content-Type": mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`,
      "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) {
    console.error(JSON.stringify({ operation: "messenger_media", type: error instanceof Error ? error.name : "unknown" }));
    return json({ status: "failed", message: "The request could not be completed. Please try again." }, 500);
  }
});
