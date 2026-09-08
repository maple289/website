/*
# Create photos table

1. New Tables
- `photos`
  - `id` (uuid, primary key, defaults to gen_random_uuid())
  - `owner_id` (uuid, not null, defaults to auth.uid(), references auth.users with cascade delete)
  - `owner_email` (text, nullable)
  - `file_name` (text, not null)
  - `storage_path` (text, not null) — path to the original image in the user-images bucket
  - `preview_path` (text, not null) — path to the webp preview variant
  - `thumbnail_path` (text, not null) — path to the webp thumbnail variant
  - `visibility` (text, not null, defaults to 'private', check constraint enforces 'public' or 'private')
  - `file_size` (bigint, nullable) — size of the original file in bytes
  - `mime_type` (text, defaults to 'image/jpeg')
  - `width` (integer, nullable) — original image width in pixels
  - `height` (integer, nullable) — original image height in pixels
  - `created_at` (timestamptz, defaults to now())

2. Security
- Enable RLS on `photos`.
- Owner-scoped CRUD: each authenticated user can only access rows they own.
- SELECT policy allows authenticated users to read their own photos AND public photos from others.
- INSERT/UPDATE/DELETE policies enforce ownership via auth.uid() = owner_id.

3. Important Notes
- The `owner_id` column defaults to auth.uid() so inserts that omit it still satisfy RLS.
- Public photos are visible to all authenticated users via the SELECT policy's `visibility = 'public'` clause.
- The table mirrors the existing `videos` table structure for consistency.
*/

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_email text,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  preview_path text NOT NULL,
  thumbnail_path text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  file_size bigint,
  mime_type text DEFAULT 'image/jpeg',
  width integer,
  height integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

-- SELECT: users can see their own photos and public photos from others
DROP POLICY IF EXISTS "select_own_photos" ON photos;
CREATE POLICY "select_own_photos" ON photos FOR SELECT
  TO authenticated USING (auth.uid() = owner_id OR visibility = 'public');

-- INSERT: only the owner can insert their own photos
DROP POLICY IF EXISTS "insert_own_photos" ON photos;
CREATE POLICY "insert_own_photos" ON photos FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

-- UPDATE: only the owner can update their own photos
DROP POLICY IF EXISTS "update_own_photos" ON photos;
CREATE POLICY "update_own_photos" ON photos FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- DELETE: only the owner can delete their own photos
DROP POLICY IF EXISTS "delete_own_photos" ON photos;
CREATE POLICY "delete_own_photos" ON photos FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

-- Index for efficient owner-scoped queries
CREATE INDEX IF NOT EXISTS idx_photos_owner_id ON photos(owner_id);
CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC);
