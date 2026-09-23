/*
# Fix user-videos storage policies to match UUID-based path prefix

## Problem
The storage.objects policies for the `user-videos` bucket were using a
`storage_path_belongs_to_user(name, auth.uid())` function that expected
paths prefixed with a slugified email folder (e.g. `username-abc12345/...`).
However, the application uploads files using the raw user UUID as the
top-level folder (e.g. `<user-id>/videos/<video-id>/<file-id>.mp4`).
This mismatch caused every video upload to fail with
"new row violates row-level security policy".

## Fix
Replace all `storage_path_belongs_to_user(name, auth.uid())` checks in the
user-videos storage policies with `(storage.foldername(name))[1] = auth.uid()::text`,
which matches the UUID-prefixed paths the application actually uses. This is
the same pattern already used by the `user-images` bucket policies.

## Modified Policies (on storage.objects, bucket = 'user-videos')
- `user_videos_read_own` — SELECT: own folder by UUID prefix
- `user_videos_insert_own` — INSERT: own folder by UUID prefix
- `user_videos_update_own` — UPDATE: own folder by UUID prefix
- `user_videos_delete_own` — DELETE: own folder by UUID prefix
- `user_videos_read_public` — unchanged (already correct)

## Security
- No change in security posture: users can still only read/write/delete
  objects within their own folder. The folder check is now simpler and
  matches the actual path format.
*/

DROP POLICY IF EXISTS "user_videos_read_own" ON storage.objects;
CREATE POLICY "user_videos_read_own"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "user_videos_insert_own" ON storage.objects;
CREATE POLICY "user_videos_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "user_videos_update_own" ON storage.objects;
CREATE POLICY "user_videos_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "user_videos_delete_own" ON storage.objects;
CREATE POLICY "user_videos_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'user-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
