import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const url = new URL(req.url);
    const videoId = url.searchParams.get("id");
    if (!videoId) {
      return new Response(JSON.stringify({ error: "Video id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Fetch the video record
    const { data: video, error: vErr } = await adminClient
      .from("videos")
      .select("id, owner_id, storage_path, visibility, mime_type, file_name, processing_status")
      .eq("id", videoId)
      .single();

    if (vErr || !video) {
      return new Response(JSON.stringify({ error: "Video not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine if the requester is allowed
    let isOwner = false;
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    if (token && token !== anonKey) {
      const userClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (userData.user && userData.user.id === video.owner_id) {
        isOwner = true;
      }
    }

    if (video.visibility !== "public" && !isOwner) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Block access to videos that are still processing or failed processing
    if (video.processing_status === "processing") {
      return new Response(JSON.stringify({ error: "Video is still being processed" }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (video.processing_status === "error") {
      return new Response(JSON.stringify({ error: "Video processing failed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Defence in depth: never sign a path that does not live inside the
    // record owner's own storage folder, even if a row somehow claims one.
    if (
      typeof video.storage_path !== "string" ||
      !video.storage_path.startsWith(`${video.owner_id}/`)
    ) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prepend the admin-configured base path for the videos bucket, if set.
    const { data: basePath } = await adminClient
      .from("storage_settings")
      .select("videos_base_path")
      .eq("id", 1)
      .maybeSingle();
    const videosBase = basePath?.videos_base_path ?? "";
    const fullStoragePath = videosBase
      ? `${videosBase}/${video.storage_path}`
      : video.storage_path;

    // Create a signed URL (valid for 1 hour) for the file
    const { data: signedData, error: signedErr } = await adminClient
      .storage
      .from("user-videos")
      .createSignedUrl(fullStoragePath, 3600);

    if (signedErr || !signedData?.signedUrl) {
      return new Response(JSON.stringify({ error: "Could not generate video URL" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        url: signedData.signedUrl,
        mime_type: video.mime_type,
        file_name: video.file_name,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("serve-media failed:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
