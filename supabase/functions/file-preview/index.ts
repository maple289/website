import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

import { previewFormats as types } from "../_shared/previewFormats.ts";

const headers = {
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...headers, "Content-Type": "application/json" },
});
const unavailable = () => json({ status: "failed", message: "File unavailable or you do not have permission to preview it." }, 404);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "GET") return json({ message: "Method not allowed" }, 405);
  const params = new URL(req.url).searchParams;
  const publicId = params.get("id"), requestedPath = params.get("path");
  if ((!publicId && !requestedPath) || (publicId && requestedPath)) return unavailable();
  try {
    const base = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(base, key, { auth: { persistSession: false } });
    let path: string;
    if (publicId) {
      if (!/^[0-9a-f-]{36}$/i.test(publicId)) return unavailable();
      const { data, error } = await service.rpc("resolve_public_user_file", { p_id: publicId });
      if (error || !data) return unavailable();
      path = data;
    } else {
      const auth = req.headers.get("Authorization") ?? "";
      const client = createClient(base, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      });
      const { data: { user }, error: authError } = await client.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (authError || !user) return unavailable();
      const { data: allowed, error } = await client.rpc("can_read_user_file", { p_path: requestedPath });
      if (error || !allowed) return unavailable();
      path = requestedPath!;
    }
    const segments = path.split("/");
    if (segments.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) return unavailable();
    const { data: source, error: sourceError } = await service.rpc("get_file_preview_source", { p_path: path });
    if (sourceError || !source) return unavailable();
    const extension = path.split(".").pop()!.toLowerCase(), type = types[extension];
    if (!type) return json({ status: "unsupported", message: "Preview is not available for this file type. You can still download the original file." });
    const [kind, mime, maximum] = type;
    if (source.size > maximum) return json({ status: "failed", message: `This file exceeds the ${maximum / 1048576} MB preview limit. You can still download the original file.` });
    let bucket = "user-files", objectPath = path;
    if (kind === "office") {
      const { data: job, error } = await service.rpc("queue_file_preview", {
        p_source_id: source.id, p_version: source.version, p_extension: extension,
      });
      if (error || !job) {
        console.error(JSON.stringify({ operation: "queue_file_preview", result: "failed", code: error?.code }));
        return json({ status: "failed", message: "Preview could not be queued. Please try again later. You can still download the original file." }, 503);
      }
      if (job.status === "failed") return json({ status: "failed", message: job.error || "Preview could not be generated. You can still download the original file." });
      if (job.status !== "ready") return json({ status: "generating", message: "Generating preview…", queued: job.status === "queued" }, 202);
      bucket = "file-previews"; objectPath = job.preview_path;
    }
    if (params.get("content") !== "1") return json({ status: "available", kind: kind === "office" ? "pdf" : kind, mime });
    const upstream = await fetch(`${base}/storage/v1/object/authenticated/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key }, redirect: "error",
    });
    if (!upstream.ok || Number(upstream.headers.get("content-length") || "0") > (bucket === "file-previews" ? 50 * 1048576 : maximum)) return unavailable();
    // Opaque public IDs stay opaque. Never disclose storage headers, paths, job
    // identities or signed URLs. The frontend creates a local Blob for rendering.
    return new Response(upstream.body, { headers: { ...headers, "Content-Type": mime,
      "Content-Disposition": "attachment", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) {
    console.error(JSON.stringify({ operation: "file_preview", result: "failed", type: error instanceof Error ? error.name : "unknown" }));
    return json({ status: "failed", message: "Preview could not be generated. You can still download the original file." }, 500);
  }
});
