/*
# Update storage policies for configurable base path

## Purpose
The admin can now configure a physical base path (e.g. `/mnt/storage/videos`)
that is prepended to every object key in the `user-videos` and `user-images`
buckets. The existing RLS policies check that the FIRST folder segment of the
object name equals `auth.uid()`. With a base path prefix, the first segment is
the base path, not the user ID, so uploads would be blocked.

## Changes
- `user-videos` INSERT/SELECT/UPDATE/DELETE policies: allow the owner folder
  to appear as EITHER the first OR second segment of the path, so both
  prefixed and unprefixed paths work.
- Same change for `user-images` policies.
- The public read policy for `user-videos` is unchanged.
*/

-- user-videos: drop and recreate owner-scoped policies
DROP POLICY IF EXISTS "user_videos_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "user_videos_read_own" ON storage.objects;
DROP POLICY IF EXISTS "user_videos_update_own" ON storage.objects;
DROP POLICY IF EXISTS "user_videos_delete_own" ON storage.objects;

CREATE POLICY "user_videos_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'user-videos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

CREATE POLICY "user_videos_read_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'user-videos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

CREATE POLICY "user_videos_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'user-videos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
)
WITH CHECK (
  bucket_id = 'user-videos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

CREATE POLICY "user_videos_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'user-videos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

-- user-images: drop and recreate owner-scoped policies
DROP POLICY IF EXISTS "user_images_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "user_images_read_own" ON storage.objects;
DROP POLICY IF EXISTS "user_images_update_own" ON storage.objects;
DROP POLICY IF EXISTS "user_images_delete_own" ON storage.objects;

CREATE POLICY "user_images_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'user-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

CREATE POLICY "user_images_read_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'user-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

CREATE POLICY "user_images_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'user-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
)
WITH CHECK (
  bucket_id = 'user-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

CREATE POLICY "user_images_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'user-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);
