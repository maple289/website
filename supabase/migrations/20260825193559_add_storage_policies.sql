/*
# Storage policies for user-videos bucket

## Purpose
RLS policies on the storage.objects table for the `user-videos` bucket.
The bucket is private (not public) — all access is mediated by these policies
and the serve-media edge function.

## Security
- Users can upload (INSERT) objects only within their own folder prefix.
- Users can read (SELECT) objects in their own folder AND objects referenced by
  public videos.
- Users can update/delete objects only within their own folder.
- The "own folder" check uses the owner's auth.uid() as the path prefix — the
  application stores files as "<display-name>-<uid>/filename.mp4" but the
  authoritative ownership check is on the videos table via the edge function.

Note: Storage object paths use the pattern "{owner_id}/{filename}" — the
display name is kept in the DB, the folder prefix uses the immutable uid
to prevent collisions and spoofing.
*/

-- Allow users to read their own stored objects
DROP POLICY IF EXISTS "user_videos_read_own" ON storage.objects;
CREATE POLICY "user_videos_read_own"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow anyone to read objects that belong to public videos
-- (The edge function handles the actual public/private check; this policy
--  allows the service role to serve public files.)
DROP POLICY IF EXISTS "user_videos_read_public" ON storage.objects;
CREATE POLICY "user_videos_read_public"
ON storage.objects FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'user-videos'
  AND EXISTS (
    SELECT 1 FROM videos v
    WHERE v.storage_path = name AND v.visibility = 'public'
  )
);

-- Allow users to upload to their own folder
DROP POLICY IF EXISTS "user_videos_insert_own" ON storage.objects;
CREATE POLICY "user_videos_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow users to update their own objects
DROP POLICY IF EXISTS "user_videos_update_own" ON storage.objects;
CREATE POLICY "user_videos_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow users to delete their own objects
DROP POLICY IF EXISTS "user_videos_delete_own" ON storage.objects;
CREATE POLICY "user_videos_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
