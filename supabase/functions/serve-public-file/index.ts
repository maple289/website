import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response("File unavailable", { status: 404, headers });
  }
  try {
    const base = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(base, key, { auth: { persistSession: false } });
    // This resolver checks the current Everyone grant and trashed ancestors on
    // every request. Never accept a client-provided storage path or redirect.
    const { data: path, error } = await client.rpc("resolve_public_user_file", { p_id: id });
    if (error || !path) return new Response("File unavailable", { status: 404, headers });
    const segments = path.split("/");
    // Metadata is owner-writable. Do not let a crafted key escape this bucket
    // through URL dot-segment normalization when using the service credential.
    if (segments.some((part: string) => !part || part === "." || part === ".." || part.includes("\\"))) {
      return new Response("File unavailable", { status: 404, headers });
    }
    const response = await fetch(`${base}/storage/v1/object/authenticated/user-files/${segments.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key }, redirect: "error",
    });
    if (!response.ok) return new Response("File unavailable", { status: 404, headers });
    // Stream bytes with a fixed, non-executable content type. No storage headers,
    // owner IDs, signed URLs or backend error details cross this boundary.
    return new Response(response.body, { headers: { ...headers,
      "Content-Type": "application/octet-stream", "Content-Disposition": "attachment",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch {
    return new Response("File unavailable", { status: 404, headers });
  }
});
