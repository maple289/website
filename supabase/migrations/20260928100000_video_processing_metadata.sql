BEGIN;
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS source_metadata jsonb,
  ADD COLUMN IF NOT EXISTS processing_action text,
  ADD COLUMN IF NOT EXISTS audio_codec text,
  ADD COLUMN IF NOT EXISTS audio_bitrate real,
  ADD COLUMN IF NOT EXISTS processed_file_size bigint;
COMMENT ON COLUMN public.videos.source_metadata IS 'Server-probed original media metadata. Bitrates are in kb/s.';
COMMENT ON COLUMN public.videos.video_bitrate IS 'Measured playable output video bitrate in kb/s, not a hard-coded target.';
-- Existing guard_validated_video rejects client changes to these fields.
COMMIT;
