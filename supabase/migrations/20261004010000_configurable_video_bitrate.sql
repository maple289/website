-- Processing settings belong to the existing admin-only singleton. This adds
-- no jobs and never modifies or reconverts existing videos.
ALTER TABLE public.storage_settings
  ADD COLUMN target_video_bitrate_mbps numeric(5,2) NOT NULL DEFAULT 3.0
  CONSTRAINT target_video_bitrate_range CHECK (target_video_bitrate_mbps BETWEEN 1 AND 15);
COMMENT ON COLUMN public.storage_settings.target_video_bitrate_mbps IS
  'Target for future video transcodes in Mbps. Compatible MP4 video <= 4.5 Mbps is not re-encoded.';
NOTIFY pgrst, 'reload schema';
