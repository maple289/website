import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async req => {
  if (req.method === "OPTIONS") return json({});
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let id: string | undefined;
  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: { user }, error } = await client.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer /i, ""));
    if (error || !user) return json({ error: "Please sign in to delete a video." }, 401);
    const body = await req.text();
    if (body.length > 1024) return json({ error: "Invalid request" }, 400);
    id = JSON.parse(body).id;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ error: "Invalid video" }, 400);
    const args = { p_id: id, p_owner: user.id };
    const begun = await client.rpc("begin_video_deletion", args);
    if (begun.error?.code === "42501") return json({ error: "Video not found or access denied." }, 403);
    if (begun.error) throw begun.error;
    if (!begun.data) return json({ pending: true }, 202);
    // Always drain from offset zero: successfully removed objects disappear from
    // the catalog. This also makes partial failure/retry idempotent.
    for (let page = 0; page < 100; page++) {
      const objects = await client.rpc("video_deletion_objects", args).limit(100);
      if (objects.error) throw objects.error;
      if (!objects.data?.length) {
        const finished = await client.rpc("finish_video_deletion", args);
        if (finished.error) throw finished.error;
        console.info(JSON.stringify({ operation: "delete_video", id, result: "complete" }));
        return json({ deleted: true });
      }
      for (const bucket of ["user-videos", "user-images", "media-staging"]) {
        const paths = objects.data.filter((o: { bucket_id: string }) => o.bucket_id === bucket).map((o: { name: string }) => o.name);
        if (!paths.length) continue;
        const removed = await client.storage.from(bucket).remove(paths);
        if (removed.error) throw removed.error;
      }
    }
    return json({ pending: true }, 202);
  } catch (error) {
    console.error(JSON.stringify({ operation: "delete_video", id, result: "error",
      code: (error as { code?: string }).code, type: (error as Error).name }));
    return json({ error: "Deletion is incomplete. Some files may already be removed. Retry to finish deleting the video; its record is retained until storage cleanup succeeds." }, 500);
  }
});
