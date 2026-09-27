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

    const { data: settingsRow } = await adminClient
      .from("storage_settings")
      .select("videos_base_path")
      .eq("id", 1)
      .maybeSingle();
    const videosBase = settingsRow?.videos_base_path ?? "";

    const bucketPath = videosBase
      ? `${videosBase}/${video.storage_path}`
      : video.storage_path;

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

    const fileBuffer = new Uint8Array(await fileData.arrayBuffer());

    // Analyze the video using pure JS binary parsing
    const metadata = analyzeVideo(fileBuffer);
    if (!metadata) {
      await markError(adminClient, videoId, "Could not analyze the video file. It may be corrupted or in an unsupported format.");
      return new Response(JSON.stringify({ error: "Analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isMp4 = metadata.container_format === "mp4";
    const isMov = metadata.container_format === "mov";
    const needsBitrateReduction = metadata.video_bitrate !== null && metadata.video_bitrate > MAX_BITRATE_KBPS;

    let processedBuffer: Uint8Array = fileBuffer;
    let action = "kept_original";
    let needsUpload = false;

    if (!isMp4 && !isMov) {
      // Non-MP4/MOV container (AVI, MKV, WebM, etc.) — cannot convert without FFmpeg
      await markError(
        adminClient,
        videoId,
        `This video is in ${metadata.container_format.toUpperCase()} format. Only MP4 and MOV files can be processed. Please convert it to MP4 before uploading.`
      );
      return new Response(JSON.stringify({ error: `Unsupported container: ${metadata.container_format}` }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isMov) {
      // MOV → MP4: change the ftyp box brand from 'qt  ' to 'isom'
      // MOV and MP4 share the same ISO BMFF container structure, so this is a valid remux
      processedBuffer = remuxMovToMp4(fileBuffer);
      if (processedBuffer) {
        action = "converted_mov_to_mp4";
        needsUpload = true;
      } else {
        // If remux fails, keep the original (browsers can usually play MOV anyway)
        processedBuffer = fileBuffer;
      }
    }

    if (needsBitrateReduction) {
      // We cannot transcode to reduce bitrate without FFmpeg.
      // Mark as ready but record that bitrate exceeds the limit.
      console.warn(`Video ${videoId} bitrate ${metadata.video_bitrate}kb/s exceeds ${MAX_BITRATE_KBPS}kb/s limit but transcoding is not available.`);
    }

    if (needsUpload) {
      const processedDbPath = video.storage_path.replace(/\.[^.]+$/, ".mp4");
      const processedBucketPath = videosBase
        ? `${videosBase}/${processedDbPath}`
        : processedDbPath;

      const { error: uploadErr } = await adminClient
        .storage
        .from("user-videos")
        .upload(processedBucketPath, processedBuffer, {
          contentType: "video/mp4",
          upsert: true,
        });

      if (uploadErr) {
        await markError(adminClient, videoId, "Could not upload the processed video.");
        return new Response(JSON.stringify({ error: "Upload of processed file failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
          container_format: "mp4",
          processing_error: null,
        })
        .eq("id", videoId);

      if (updateErr) console.error("Failed to update video record:", updateErr);
    } else {
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

      if (updateErr) console.error("Failed to update video record:", updateErr);
    }

    return new Response(JSON.stringify({ success: true, action, metadata }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

// ─── Binary helpers ──────────────────────────────────────────────

function readUint32(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 24 | buf[offset + 1] << 16 | buf[offset + 2] << 8 | buf[offset + 3]) >>> 0;
}

function readFourCC(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

function readUint16(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8 | buf[offset + 1]) >>> 0;
}

// ─── Container detection ─────────────────────────────────────────

function detectContainer(buf: Uint8Array): string {
  if (buf.length < 12) return "unknown";

  // Check for RIFF (AVI)
  if (buf.length >= 12 && readFourCC(buf, 0) === "RIFF") {
    const type = readFourCC(buf, 8);
    if (type === "AVI ") return "avi";
  }

  // Check for EBML (MKV/WebM)
  if (buf.length >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
    // Distinguish WebM from MKV by checking for 'webm' in the DocType
    // For simplicity, check first 64 bytes for 'webm' string
    const header = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 64)));
    if (header.includes("webm")) return "webm";
    return "mkv";
  }

  // Check for ISO BMFF (MP4/MOV) — ftyp box at offset 4
  if (buf.length >= 12 && readFourCC(buf, 4) === "ftyp") {
    const brand = readFourCC(buf, 8);
    if (brand === "qt  ") return "mov";
    return "mp4";
  }

  return "unknown";
}

// ─── MP4/MOV box parser ──────────────────────────────────────────

interface Box {
  type: string;
  offset: number;
  size: number;
  dataOffset: number;
  dataSize: number;
}

function* iterBoxes(buf: Uint8Array, start: number, end: number): Generator<Box> {
  let offset = start;
  while (offset + 8 <= end) {
    let size = readUint32(buf, offset);
    const type = readFourCC(buf, offset + 4);

    if (size === 0) {
      // Box extends to end of container
      size = end - offset;
    } else if (size === 1) {
      // 64-bit large size
      if (offset + 16 > end) break;
      const hi = readUint32(buf, offset + 8);
      const lo = readUint32(buf, offset + 12);
      size = hi * 0x100000000 + lo;
      yield { type, offset, size, dataOffset: offset + 16, dataSize: size - 16 };
      offset += size;
      continue;
    }

    if (size < 8 || offset + size > end) break;

    yield { type, offset, size, dataOffset: offset + 8, dataSize: size - 8 };
    offset += size;
  }
}

function findBox(buf: Uint8Array, start: number, end: number, type: string): Box | null {
  for (const box of iterBoxes(buf, start, end)) {
    if (box.type === type) return box;
  }
  return null;
}

function findAllBoxes(buf: Uint8Array, start: number, end: number, type: string): Box[] {
  const result: Box[] = [];
  for (const box of iterBoxes(buf, start, end)) {
    if (box.type === type) result.push(box);
  }
  return result;
}

function parseMvhd(buf: Uint8Array, box: Box): { duration: number; timescale: number } | null {
  let offset = box.dataOffset;
  const version = buf[offset];
  offset += 1;
  // flags (3 bytes)
  offset += 3;
  if (version === 1) {
    // creation_time (8), modification_time (8), timescale (4), duration (8)
    offset += 16;
    const timescale = readUint32(buf, offset);
    offset += 4;
    // duration is 64-bit, read high 32 bits
    const hi = readUint32(buf, offset);
    const lo = readUint32(buf, offset + 4);
    const duration = hi * 0x100000000 + lo;
    return { duration, timescale };
  } else {
    // creation_time (4), modification_time (4), timescale (4), duration (4)
    offset += 8;
    const timescale = readUint32(buf, offset);
    offset += 4;
    const duration = readUint32(buf, offset);
    return { duration, timescale };
  }
}

function parseTkhd(buf: Uint8Array, box: Box): { width: number; height: number } | null {
  let offset = box.dataOffset;
  const version = buf[offset];
  offset += 1;
  offset += 3; // flags
  if (version === 1) {
    offset += 8 + 8; // creation, modification
    offset += 4; // track_id, reserved
    offset += 4; // duration
  } else {
    offset += 4 + 4; // creation, modification
    offset += 4; // track_id, reserved
    offset += 4; // duration
  }
  offset += 8; // reserved
  offset += 2; // layer
  offset += 2; // alternate_group
  offset += 2; // volume
  offset += 2; // reserved
  // matrix (36 bytes)
  offset += 36;
  // width and height are 32.16 fixed-point
  const width = readUint32(buf, offset) / 65536;
  const height = readUint32(buf, offset + 4) / 65536;
  return { width: Math.round(width), height: Math.round(height) };
}

function parseStsd(buf: Uint8Array, box: Box): { codec: string; width: number; height: number } | null {
  let offset = box.dataOffset;
  offset += 4; // version + flags
  offset += 4; // entry_count
  // First entry
  if (offset + 8 > box.offset + box.size) return null;
  const entrySize = readUint32(buf, offset);
  const codec = readFourCC(buf, offset + 4);
  // Visual sample entry structure:
  // 6 bytes reserved, 2 bytes data_reference_index
  // 2 bytes version, 2 bytes revision, 4 bytes vendor
  // 4 bytes temporal_quality, 4 bytes spatial_quality
  // 4 bytes width, 4 bytes height
  // ...
  let entryOffset = offset + 8 + 6 + 2 + 2 + 2 + 4 + 4 + 4;
  if (entryOffset + 8 > offset + entrySize) {
    // Not enough data for width/height, return codec only
    return { codec, width: 0, height: 0 };
  }
  const width = readUint16(buf, entryOffset);
  const height = readUint16(buf, entryOffset + 4);
  return { codec, width, height };
}

function parseMdhd(buf: Uint8Array, box: Box): { duration: number; timescale: number } | null {
  let offset = box.dataOffset;
  const version = buf[offset];
  offset += 1;
  offset += 3; // flags
  if (version === 1) {
    offset += 16;
    const timescale = readUint32(buf, offset);
    offset += 4;
    const hi = readUint32(buf, offset);
    const lo = readUint32(buf, offset + 4);
    const duration = hi * 0x100000000 + lo;
    return { duration, timescale };
  } else {
    offset += 8;
    const timescale = readUint32(buf, offset);
    offset += 4;
    const duration = readUint32(buf, offset);
    return { duration, timescale };
  }
}

function parseHdlr(buf: Uint8Array, box: Box): string | null {
  let offset = box.dataOffset;
  offset += 4; // version + flags
  offset += 4; // pre_defined
  // handler_type (4 bytes)
  if (offset + 4 > box.offset + box.size) return null;
  return readFourCC(buf, offset);
}

function parseStts(buf: Uint8Array, box: Box): { frameRate: number; frameCount: number; trackDuration: number } | null {
  let offset = box.dataOffset;
  offset += 4; // version + flags
  const entryCount = readUint32(buf, offset);
  offset += 4;
  let totalFrames = 0;
  let totalDuration = 0;
  for (let i = 0; i < entryCount && offset + 8 <= box.offset + box.size; i++) {
    const sampleCount = readUint32(buf, offset);
    const sampleDelta = readUint32(buf, offset + 4);
    totalFrames += sampleCount;
    totalDuration += sampleCount * sampleDelta;
    offset += 8;
  }
  const frameRate = totalDuration > 0 ? totalFrames / totalDuration : 0;
  return { frameRate: Math.round(frameRate * 100) / 100, frameCount: totalFrames, trackDuration: totalDuration };
}

function parseStsz(buf: Uint8Array, box: Box): { totalSize: number; sampleCount: number } | null {
  let offset = box.dataOffset;
  offset += 4; // version + flags
  const sampleSize = readUint32(buf, offset);
  offset += 4;
  const sampleCount = readUint32(buf, offset);
  offset += 4;
  if (sampleSize > 0) {
    return { totalSize: sampleSize * sampleCount, sampleCount };
  }
  // Variable sizes — sum entries
  let totalSize = 0;
  for (let i = 0; i < sampleCount && offset + 4 <= box.offset + box.size; i++) {
    totalSize += readUint32(buf, offset);
    offset += 4;
  }
  return { totalSize, sampleCount };
}

function analyzeVideo(buf: Uint8Array): VideoMetadata | null {
  const container = detectContainer(buf);

  if (container !== "mp4" && container !== "mov") {
    // For non-ISO-BMFF containers, return basic info
    return {
      container_format: container,
      video_codec: null,
      video_bitrate: null,
      resolution_width: null,
      resolution_height: null,
      frame_rate: null,
      duration_seconds: null,
    };
  }

  // Parse ISO BMFF (MP4/MOV) box structure
  const ftypBox = findBox(buf, 0, buf.length, "ftyp");
  if (!ftypBox) return null;

  // Find moov box
  const moovBox = findBox(buf, 0, buf.length, "moov");
  if (!moovBox) return null;

  const moovStart = moovBox.dataOffset;
  const moovEnd = moovBox.offset + moovBox.size;

  // Parse mvhd for overall duration
  const mvhdBox = findBox(buf, moovStart, moovEnd, "mvhd");
  let durationSeconds: number | null = null;
  let movieTimescale = 0;
  let movieDuration = 0;
  if (mvhdBox) {
    const mvhd = parseMvhd(buf, mvhdBox);
    if (mvhd && mvhd.timescale > 0) {
      movieTimescale = mvhd.timescale;
      movieDuration = mvhd.duration;
      durationSeconds = movieDuration / movieTimescale;
    }
  }

  // Find all trak boxes
  const trakBoxes = findAllBoxes(buf, moovStart, moovEnd, "trak");
  let videoCodec: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let frameRate: number | null = null;
  let videoBitrate: number | null = null;

  for (const trak of trakBoxes) {
    const trakStart = trak.dataOffset;
    const trakEnd = trak.offset + trak.size;

    // Check handler type
    const mdiaBox = findBox(buf, trakStart, trakEnd, "mdia");
    if (!mdiaBox) continue;

    const mdiaStart = mdiaBox.dataOffset;
    const mdiaEnd = mdiaBox.offset + mdiaBox.size;

    const hdlrBox = findBox(buf, mdiaStart, mdiaEnd, "hdlr");
    if (!hdlrBox) continue;
    const handlerType = parseHdlr(buf, hdlrBox);
    if (handlerType !== "vide") continue;

    // This is a video track
    // Parse tkhd for width/height
    const tkhdBox = findBox(buf, trakStart, trakEnd, "tkhd");
    if (tkhdBox) {
      const tkhd = parseTkhd(buf, tkhdBox);
      if (tkhd) {
        width = tkhd.width;
        height = tkhd.height;
      }
    }

    // Parse mdhd for track timescale/duration
    const mdhdBox = findBox(buf, mdiaStart, mdiaEnd, "mdhd");
    let trackTimescale = 0;
    let trackDuration = 0;
    if (mdhdBox) {
      const mdhd = parseMdhd(buf, mdhdBox);
      if (mdhd && mdhd.timescale > 0) {
        trackTimescale = mdhd.timescale;
        trackDuration = mdhd.duration;
        if (!durationSeconds && trackTimescale > 0) {
          durationSeconds = trackDuration / trackTimescale;
        }
      }
    }

    // Parse stbl for codec, frame rate, bitrate
    const minfBox = findBox(buf, mdiaStart, mdiaEnd, "minf");
    if (!minfBox) continue;
    const minfStart = minfBox.dataOffset;
    const minfEnd = minfBox.offset + minfBox.size;

    const stblBox = findBox(buf, minfStart, minfEnd, "stbl");
    if (!stblBox) continue;
    const stblStart = stblBox.dataOffset;
    const stblEnd = stblBox.offset + stblBox.size;

    // Codec and resolution from stsd
    const stsdBox = findBox(buf, stblStart, stblEnd, "stsd");
    if (stsdBox) {
      const stsd = parseStsd(buf, stsdBox);
      if (stsd) {
        videoCodec = stsd.codec;
        if (stsd.width > 0 && (!width || width === 0)) width = stsd.width;
        if (stsd.height > 0 && (!height || height === 0)) height = stsd.height;
      }
    }

    // Frame rate from stts
    const sttsBox = findBox(buf, stblStart, stblEnd, "stts");
    if (sttsBox) {
      const stts = parseStts(buf, sttsBox);
      if (stts && stts.frameRate > 0) {
        frameRate = stts.frameRate;
      }
    }

    // Bitrate from stsz (total sample sizes / duration)
    const stszBox = findBox(buf, stblStart, stblEnd, "stsz");
    if (stszBox) {
      const stsz = parseStsz(buf, stszBox);
      if (stsz && stsz.sampleCount > 0 && durationSeconds && durationSeconds > 0) {
        // Bitrate = total bytes * 8 / duration in seconds
        const totalBits = stsz.totalSize * 8;
        const bps = totalBits / durationSeconds;
        videoBitrate = Math.round(bps / 1000); // kb/s
      }
    }

    break; // Only process first video track
  }

  return {
    container_format: container,
    video_codec: videoCodec,
    video_bitrate: videoBitrate,
    resolution_width: width,
    resolution_height: height,
    frame_rate: frameRate,
    duration_seconds: durationSeconds,
  };
}

// ─── MOV → MP4 remux ─────────────────────────────────────────────

function remuxMovToMp4(buf: Uint8Array): Uint8Array | null {
  // The ftyp box should be at offset 0
  if (buf.length < 16 || readFourCC(buf, 4) !== "ftyp") return null;

  const ftypSize = readUint32(buf, 0);
  if (ftypSize < 16 || ftypSize > buf.length) return null;

  // Check that current brand is 'qt  '
  const currentBrand = readFourCC(buf, 8);
  if (currentBrand !== "qt  ") return null;

  // Copy the buffer and change the brand to 'isom'
  const result = new Uint8Array(buf);
  // Write 'isom' at offset 8 (major brand)
  result[8] = 0x69; // i
  result[9] = 0x73; // s
  result[10] = 0x6F; // o
  result[11] = 0x6D; // m

  // Also update compatible brands if there's room
  // ftyp structure: size(4) + 'ftyp'(4) + major_brand(4) + minor_version(4) + compatible_brands(4 each)
  // At offset 16+, write 'isom' and 'mp42' as compatible brands if they're not already there
  if (ftypSize >= 24) {
    // Write 'isom' at offset 16
    result[16] = 0x69; result[17] = 0x73; result[18] = 0x6F; result[19] = 0x6D;
  }
  if (ftypSize >= 28) {
    // Write 'mp42' at offset 20
    result[20] = 0x6D; result[21] = 0x70; result[22] = 0x34; result[23] = 0x32;
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────

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
