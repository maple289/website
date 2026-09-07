import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface VideoMetadata {
  container_format: string;
  video_codec: string | null;
  video_bitrate: number | null; // kb/s
  resolution_width: number | null;
  resolution_height: number | null;
  frame_rate: number | null;
  duration_seconds: number | null;
}

const MAX_BITRATE_KBPS = 2000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let videoId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.json();
    videoId = body?.video_id;
    if (!videoId) {
      return new Response(JSON.stringify({ error: "video_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the video record
    const { data: video, error: vErr } = await adminClient
      .from("videos")
      .select("id, owner_id, storage_path, file_name, mime_type")
      .eq("id", videoId)
      .single();

    if (vErr || !video) {
      return new Response(JSON.stringify({ error: "Video not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the admin-configured base path for videos
    const { data: settingsRow } = await adminClient
      .from("storage_settings")
      .select("videos_base_path")
      .eq("id", 1)
      .maybeSingle();
    const videosBase = settingsRow?.videos_base_path ?? "";

    const bucketPath = videosBase
      ? `${videosBase}/${video.storage_path}`
      : video.storage_path;

    // Download the original video from storage
    const { data: fileData, error: downloadErr } = await adminClient
      .storage
      .from("user-videos")
      .download(bucketPath);

    if (downloadErr || !fileData) {
      await markError(adminClient, videoId, "Could not download the uploaded video for processing.");
      return new Response(JSON.stringify({ error: "Download failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Write to a temp file
    const originalPath = `/tmp/${videoId}_original`;
    const processedPath = `/tmp/${videoId}_processed.mp4`;

    const fileBuffer = await fileData.arrayBuffer();
    await Deno.writeFile(originalPath, new Uint8Array(fileBuffer));

    // Analyze with FFprobe
    const metadata = await analyzeVideo(originalPath);
    if (!metadata) {
      await markError(adminClient, videoId, "Could not analyze the video file. It may be corrupted or in an unsupported format.");
      await cleanup(originalPath);
      return new Response(JSON.stringify({ error: "Analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine if conversion is needed
    const isMp4 = metadata.container_format === "mp4" || metadata.container_format === "mov";
    const needsBitrateReduction = metadata.video_bitrate !== null && metadata.video_bitrate > MAX_BITRATE_KBPS;

    let needsConversion = false;
    let ffmpegArgs: string[] = [];

    if (!isMp4) {
      // Non-MP4 container: convert to MP4
      needsConversion = true;
      if (needsBitrateReduction) {
        ffmpegArgs = [
          "-i", originalPath,
          "-c:v", "libx264",
          "-b:v", `${MAX_BITRATE_KBPS}k`,
          "-maxrate", `${MAX_BITRATE_KBPS}k`,
          "-bufsize", `${MAX_BITRATE_KBPS * 2}k`,
          "-c:a", "aac",
          "-movflags", "+faststart",
          "-y",
          processedPath,
        ];
      } else {
        // Remux to MP4 without re-encoding video (if codec is compatible) or transcode
        ffmpegArgs = [
          "-i", originalPath,
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", "20",
          "-c:a", "aac",
          "-movflags", "+faststart",
          "-y",
          processedPath,
        ];
      }
    } else if (needsBitrateReduction) {
      // MP4 but bitrate too high: transcode at target bitrate
      needsConversion = true;
      ffmpegArgs = [
        "-i", originalPath,
        "-c:v", "libx264",
        "-b:v", `${MAX_BITRATE_KBPS}k`,
        "-maxrate", `${MAX_BITRATE_KBPS}k`,
        "-bufsize", `${MAX_BITRATE_KBPS * 2}k`,
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y",
        processedPath,
      ];
    }

    if (needsConversion) {
      // Run FFmpeg
      const ffmpegResult = await runCommand("ffmpeg", ffmpegArgs);
      if (!ffmpegResult.success) {
        await markError(adminClient, videoId, "Video conversion failed. The file may use an unsupported codec.");
        await cleanup(originalPath);
        return new Response(JSON.stringify({ error: "Conversion failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Upload the processed file
      const processedDbPath = video.storage_path.replace(/\.[^.]+$/, ".mp4");
      const processedBucketPath = videosBase
        ? `${videosBase}/${processedDbPath}`
        : processedDbPath;

      const processedFile = await Deno.readFile(processedPath);
      const { error: uploadErr } = await adminClient
        .storage
        .from("user-videos")
        .upload(processedBucketPath, processedFile, {
          contentType: "video/mp4",
          upsert: true,
        });

      if (uploadErr) {
        await markError(adminClient, videoId, "Could not upload the processed video.");
        await cleanup(originalPath, processedPath);
        return new Response(JSON.stringify({ error: "Upload of processed file failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update the video record with processed path and metadata
      const { error: updateErr } = await adminClient
        .from("videos")
        .update({
          processing_status: "ready",
          processed_storage_path: processedDbPath,
          storage_path: processedDbPath,
          mime_type: "video/mp4",
          video_codec: metadata.video_codec,
          video_bitrate: metadata.video_bitrate,
          resolution_width: metadata.resolution_width,
          resolution_height: metadata.resolution_height,
          frame_rate: metadata.frame_rate,
          duration_seconds: metadata.duration_seconds,
          container_format: metadata.container_format,
          processing_error: null,
        })
        .eq("id", videoId);

      if (updateErr) {
        console.error("Failed to update video record:", updateErr);
      }

      // Clean up temp files
      await cleanup(originalPath, processedPath);

      return new Response(JSON.stringify({
        success: true,
        action: "converted",
        metadata,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // No conversion needed — keep original, just update metadata
      const { error: updateErr } = await adminClient
        .from("videos")
        .update({
          processing_status: "ready",
          video_codec: metadata.video_codec,
          video_bitrate: metadata.video_bitrate,
          resolution_width: metadata.resolution_width,
          resolution_height: metadata.resolution_height,
          frame_rate: metadata.frame_rate,
          duration_seconds: metadata.duration_seconds,
          container_format: metadata.container_format,
          processing_error: null,
        })
        .eq("id", videoId);

      if (updateErr) {
        console.error("Failed to update video record:", updateErr);
      }

      await cleanup(originalPath);

      return new Response(JSON.stringify({
        success: true,
        action: "kept_original",
        metadata,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("process-video failed:", err);
    if (videoId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });
      await markError(adminClient, videoId, "An unexpected error occurred during video processing.");
    }
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function analyzeVideo(filePath: string): Promise<VideoMetadata | null> {
  try {
    // Get container format
    const formatResult = await runCommand("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    if (!formatResult.success) return null;

    const data = JSON.parse(formatResult.stdout);

    // Determine container format from format_name
    const formatName: string = data.format?.format_name ?? "";
    let containerFormat = "unknown";
    if (formatName.includes("mov,mp4,m4a,3gp,3g2,mj2") || formatName.includes("mp4") || formatName.includes("mov")) {
      containerFormat = "mp4";
    } else if (formatName.includes("matroska") || formatName.includes("mkv")) {
      containerFormat = "mkv";
    } else if (formatName.includes("avi")) {
      containerFormat = "avi";
    } else if (formatName.includes("webm")) {
      containerFormat = "webm";
    } else {
      containerFormat = formatName.split(",")[0] ?? "unknown";
    }

    // Find the video stream
    const videoStream = (data.streams ?? []).find((s: { codec_type: string }) => s.codec_type === "video");
    if (!videoStream) return null;

    const videoCodec = videoStream.codec_name ?? null;

    // Video stream bitrate in bits/s — prefer stream-level, fall back to format-level
    let videoBitrateBps: number | null = null;
    if (videoStream.bit_rate) {
      videoBitrateBps = parseInt(videoStream.bit_rate, 10);
    } else if (data.format?.bit_rate && videoStream.codec_type === "video") {
      // If only format bitrate is available, estimate video portion as 90% of total
      videoBitrateBps = Math.round(parseInt(data.format.bit_rate, 10) * 0.9);
    }
    const videoBitrateKbps = videoBitrateBps !== null ? Math.round(videoBitrateBps / 1000) : null;

    const resolutionWidth = videoStream.width ? parseInt(videoStream.width, 10) : null;
    const resolutionHeight = videoStream.height ? parseInt(videoStream.height, 10) : null;

    // Frame rate: r_frame_rate is a fraction like "30000/1001"
    let frameRate: number | null = null;
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
      if (den && den > 0) frameRate = Math.round((num / den) * 100) / 100;
    } else if (videoStream.avg_frame_rate) {
      const [num, den] = videoStream.avg_frame_rate.split("/").map(Number);
      if (den && den > 0) frameRate = Math.round((num / den) * 100) / 100;
    }

    const durationSeconds = data.format?.duration ? parseFloat(data.format.duration) : null;

    return {
      container_format: containerFormat,
      video_codec: videoCodec,
      video_bitrate: videoBitrateKbps,
      resolution_width: resolutionWidth,
      resolution_height: resolutionHeight,
      frame_rate: frameRate,
      duration_seconds: durationSeconds,
    };
  } catch (err) {
    console.error("FFprobe analysis failed:", err);
    return null;
  }
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  const command = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();
  const decoder = new TextDecoder();

  return {
    success: code === 0,
    stdout: decoder.decode(stdout),
    stderr: decoder.decode(stderr),
  };
}

async function markError(client: ReturnType<typeof createClient>, videoId: string, message: string): Promise<void> {
  try {
    await client.from("videos").update({
      processing_status: "error",
      processing_error: message,
    }).eq("id", videoId);
  } catch (err) {
    console.error("Failed to mark video as error:", err);
  }
}

async function cleanup(...paths: string[]): Promise<void> {
  for (const p of paths) {
    try { await Deno.remove(p); } catch { /* ignore */ }
  }
}
