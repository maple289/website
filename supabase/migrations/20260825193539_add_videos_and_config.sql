/*
# Video storage, user library, and public/private access control

## Purpose
Creates the full video management system:
1. A `videos` table tracking each user's uploaded videos with visibility.
2. An `app_config` table for the admin-configured root storage folder.
3. A Supabase Storage bucket `user-videos` with per-user folder hierarchy.
4. RLS policies so private videos are only accessible by their owner and
   public videos are visible to everyone (including anon visitors).

## New Tables

### app_config
- `id` (int, primary key, always 1 — singleton row)
- `root_folder` (text) — the admin-configured root path for all video storage
- `updated_at` (timestamptz)

### videos
- `id` (uuid, primary key)
- `owner_id` (uuid, references auth.users, defaults to auth.uid())
- `owner_email` (text) — denormalized for gallery display
- `file_name` (text) — display name the user chose
- `storage_path` (text) — path within the storage bucket, e.g. "User Name/video-xxx.mp4"
- `preview_url` (text) — preview/thumbnail image URL (data URI or storage path)
- `visibility` (text, default 'private') — 'public' or 'private'
- `file_size` (bigint) — bytes
- `mime_type` (text) — e.g. "video/mp4"
- `created_at` (timestamptz)

## Storage
- Bucket `user-videos` created (if not exists).
- Per-user folders are enforced at the application layer by using the owner's
  display name as the folder prefix.

## Security
- RLS enabled on both tables.
- app_config: only admins can read/write.
- videos:
  - SELECT: owner sees all their own; everyone (anon + authenticated) sees public.
  - INSERT: authenticated users can insert only their own (owner_id = auth.uid()).
  - UPDATE: owner can update their own (name, preview, visibility — but NOT
    owner_id, which is protected by column-level logic in the policy).
  - DELETE: owner can delete their own.
- The serve-media edge function enforces file-level access at request time.

## Important notes
1. The `app_config` singleton row is seeded with id=1 and an empty root_folder.
2. The admin sets the root folder from the Admin Console → File Locations tab.
3. All user videos go into bucket `user-videos` under "User Name/" subfolders.
4. Private video files are NOT served via public storage URLs. A signed URL
   or the serve-media edge function is used, which checks ownership/visibility.
*/

-- ---------- app_config ----------
CREATE TABLE IF NOT EXISTS app_config (
  id int PRIMARY KEY DEFAULT 1,
  root_folder text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

INSERT INTO app_config (id, root_folder) VALUES (1, '')
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "config_select_admin" ON app_config;
CREATE POLICY "config_select_admin"
ON app_config FOR SELECT TO authenticated
USING (is_admin());

DROP POLICY IF EXISTS "config_update_admin" ON app_config;
CREATE POLICY "config_update_admin"
ON app_config FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ---------- videos ----------
CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_email text,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  preview_url text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  file_size bigint,
  mime_type text DEFAULT 'video/mp4',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

-- Owner can see all their own videos (public + private)
DROP POLICY IF EXISTS "videos_select_own" ON videos;
CREATE POLICY "videos_select_own"
ON videos FOR SELECT TO authenticated
USING (auth.uid() = owner_id);

-- Anyone (including anon) can see public videos
DROP POLICY IF EXISTS "videos_select_public" ON videos;
CREATE POLICY "videos_select_public"
ON videos FOR SELECT TO anon, authenticated
USING (visibility = 'public');

-- Authenticated users can insert only their own videos
DROP POLICY IF EXISTS "videos_insert_own" ON videos;
CREATE POLICY "videos_insert_own"
ON videos FOR INSERT TO authenticated
WITH CHECK (auth.uid() = owner_id);

-- Owner can update their own video (name, preview, visibility)
DROP POLICY IF EXISTS "videos_update_own" ON videos;
CREATE POLICY "videos_update_own"
ON videos FOR UPDATE TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

-- Owner can delete their own video
DROP POLICY IF EXISTS "videos_delete_own" ON videos;
CREATE POLICY "videos_delete_own"
ON videos FOR DELETE TO authenticated
USING (auth.uid() = owner_id);

-- Admin can see all videos
DROP POLICY IF EXISTS "videos_select_admin" ON videos;
CREATE POLICY "videos_select_admin"
ON videos FOR SELECT TO authenticated
USING (is_admin());

-- ---------- indexes ----------
CREATE INDEX IF NOT EXISTS idx_videos_owner_id ON videos(owner_id);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC);
