/*
# Add video processing columns

## Purpose
Support automated server-side video analysis and conversion:
- Track processing status (processing, ready, error)
- Store FFprobe analysis results (codec, bitrate, resolution, frame rate, duration)
- Store the path to the processed MP4 file (separate from the original)
- Store processing error messages for debugging

## Changes
- Add columns to `videos` table:
  - processing_status: text, default 'processing' — 'processing' | 'ready' | 'error'
  - processed_storage_path: text, nullable — path to the converted MP4
  - processing_error: text, nullable — error message if processing failed
  - video_codec: text, nullable — detected video codec
  - video_bitrate: integer, nullable — video stream bitrate in kb/s
  - resolution_width: integer, nullable
  - resolution_height: integer, nullable
  - frame_rate: real, nullable
  - duration_seconds: real, nullable
  - container_format: text, nullable — detected container format
*/

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'processing'
    CHECK (processing_status IN ('processing', 'ready', 'error')),
  ADD COLUMN IF NOT EXISTS processed_storage_path text,
  ADD COLUMN IF NOT EXISTS processing_error text,
  ADD COLUMN IF NOT EXISTS video_codec text,
  ADD COLUMN IF NOT EXISTS video_bitrate integer,
  ADD COLUMN IF NOT EXISTS resolution_width integer,
  ADD COLUMN IF NOT EXISTS resolution_height integer,
  ADD COLUMN IF NOT EXISTS frame_rate real,
  ADD COLUMN IF NOT EXISTS duration_seconds real,
  ADD COLUMN IF NOT EXISTS container_format text;

-- Backfill existing videos as 'ready' since they were uploaded before processing existed
UPDATE videos SET processing_status = 'ready' WHERE processing_status IS NULL OR processing_status = 'processing';
