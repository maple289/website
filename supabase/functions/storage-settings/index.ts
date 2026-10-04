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
  if (!/^[a-zA-Z0-9._/: -]+$/.test(path)) {
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
        .select("videos_base_path, images_base_path, file_server_url, target_video_bitrate_mbps, updated_at")
        .eq("id", 1)
        .maybeSingle();

      if (settingsErr) {
        console.error("storage-settings GET failed:", settingsErr);
        return json({ error: "Could not load storage settings." }, 500);
      }

      return json({
        videos_base_path: settings?.videos_base_path ?? "",
        images_base_path: settings?.images_base_path ?? "",
        file_server_url: settings?.file_server_url ?? "",
        target_video_bitrate_mbps: Number(settings?.target_video_bitrate_mbps ?? 3),
        updated_at: settings?.updated_at ?? null,
      });
    }

    // PUT: update settings
    if (req.method === "PUT") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid settings." }, 400);
      const changes: Record<string, unknown> = {};
      for (const [field, label] of [["videos_base_path", "Video storage location"], ["images_base_path", "Image storage location"]]) {
        if (!(field in body)) continue;
        if (typeof body[field] !== "string") return json({ error: `${label}: Enter a valid path.` }, 400);
        const path = sanitizePath(body[field]);
        const error = validatePath(path);
        if (error) return json({ error: `${label}: ${error}` }, 400);
        changes[field] = path;
      }
      if ("target_video_bitrate_mbps" in body) {
        const value = body.target_video_bitrate_mbps;
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 15 ||
          Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
          return json({ error: "Target Video Bitrate must be between 1 and 15 Mbps, with at most two decimal places." }, 400);
        }
        changes.target_video_bitrate_mbps = value;
      }
      if ("file_server_url" in body && typeof body.file_server_url !== "string") return json({ error: "Enter a valid File Storage Server URL." }, 400);
      const fileServerUrlRaw = typeof body.file_server_url === "string" ? body.file_server_url.trim() : "";

      // Validate file server URL if provided
      if (fileServerUrlRaw) {
        try {
          const parsed = new URL(fileServerUrlRaw);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return json({ error: "File Storage Server URL must use http:// or https://" }, 400);
          }
        } catch {
          // Could be a bare IP/hostname without scheme — prepend http:// and retry
          try {
            new URL(`http://${fileServerUrlRaw}`);
          } catch {
            return json({ error: "File Storage Server URL is not a valid URL or IP address." }, 400);
          }
        }
      }
      if ("file_server_url" in body) changes.file_server_url = fileServerUrlRaw;
      if (!Object.keys(changes).length) return json({ error: "No settings were provided." }, 400);

      const { data: settings, error: updateErr } = await adminClient
        .from("storage_settings")
        .update({
          ...changes,
          updated_at: new Date().toISOString(),
          updated_by: callerData.user.id,
        })
        .eq("id", 1)
        .select("videos_base_path, images_base_path, file_server_url, target_video_bitrate_mbps, updated_at")
        .single();

      if (updateErr) {
        console.error("storage-settings PUT failed:", updateErr);
        return json({ error: "Could not save storage settings." }, 500);
      }

      return json({ ...settings, target_video_bitrate_mbps: Number(settings.target_video_bitrate_mbps) });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("storage-settings failed:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
