import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizePath(raw: string): string {
  let p = raw.trim().replace(/\\/g, "/");
  // Collapse multiple slashes
  p = p.replace(/\/+/g, "/");
  // Strip trailing slash (unless it's just "/")
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function validatePath(path: string): string | null {
  if (!path) return "Path cannot be empty.";
  if (path.length > 512) return "Path is too long (max 512 characters).";
  // Allow absolute Unix paths, relative paths, and drive-letter paths (Windows)
  if (!/^[a-zA-Z0-9._\-\/: ]+$/.test(path)) {
    return "Path contains invalid characters. Only letters, numbers, dots, dashes, slashes, and colons are allowed.";
  }
  // Reject parent-directory traversal
  if (path.includes("..")) {
    return "Path cannot contain '..' segments.";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    // Verify caller is authenticated
    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Verify caller is admin
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerData.user.id)
      .single();
    if (profileErr || !profile || profile.role !== "admin") {
      return json({ error: "Admin access required" }, 403);
    }

    // GET: return current settings
    if (req.method === "GET") {
      const { data: settings, error: settingsErr } = await adminClient
        .from("storage_settings")
        .select("videos_base_path, images_base_path, updated_at")
        .eq("id", 1)
        .maybeSingle();

      if (settingsErr) {
        console.error("storage-settings GET failed:", settingsErr);
        return json({ error: "Could not load storage settings." }, 500);
      }

      return json({
        videos_base_path: settings?.videos_base_path ?? "",
        images_base_path: settings?.images_base_path ?? "",
        updated_at: settings?.updated_at ?? null,
      });
    }

    // PUT: update settings
    if (req.method === "PUT") {
      const body = await req.json();
      const { videos_base_path, images_base_path } = body as {
        videos_base_path?: string;
        images_base_path?: string;
      };

      const videosRaw = typeof videos_base_path === "string" ? videos_base_path : "";
      const imagesRaw = typeof images_base_path === "string" ? images_base_path : "";

      const videosPath = sanitizePath(videosRaw);
      const imagesPath = sanitizePath(imagesRaw);

      const vErr = validatePath(videosPath);
      const iErr = validatePath(imagesPath);
      if (vErr) return json({ error: `Video storage location: ${vErr}` }, 400);
      if (iErr) return json({ error: `Image storage location: ${iErr}` }, 400);

      const { error: updateErr } = await adminClient
        .from("storage_settings")
        .update({
          videos_base_path: videosPath,
          images_base_path: imagesPath,
          updated_at: new Date().toISOString(),
          updated_by: callerData.user.id,
        })
        .eq("id", 1);

      if (updateErr) {
        console.error("storage-settings PUT failed:", updateErr);
        return json({ error: "Could not save storage settings." }, 500);
      }

      return json({
        videos_base_path: videosPath,
        images_base_path: imagesPath,
        updated_at: new Date().toISOString(),
      });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("storage-settings failed:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
