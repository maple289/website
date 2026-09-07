/*
# Add preview_path column to videos table

## Purpose
The UploadModal and other components insert and reference a `preview_path`
column on the `videos` table, but this column was never created. This causes
the database insert to fail with "We could not save this video."

## Changes
- Add `preview_path` text column (nullable) to the `videos` table.
*/

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS preview_path text;
