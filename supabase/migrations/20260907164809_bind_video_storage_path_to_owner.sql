/*
# F2: Bind a video row's storage_path to the row owner

## Problem
The live `videos_insert_own` / `videos_update_own` policies checked only
`auth.uid() = owner_id`. Nothing tied `storage_path` to the caller, so a
signed-in user could insert a row they own that points at ANOTHER user's
object in the `user-videos` bucket. The `serve-media` edge function reads the
row with the service role and decides access purely from `owner_id`, so it
would then mint a signed URL for the victim's private file. Setting
`visibility = 'public'` additionally satisfied the `user_videos_read_public`
storage policy, exposing the victim's file to anonymous visitors.

The `storage_path LIKE auth.uid()::text || '/%'` clause existed in
supabase/migrations/20260901204509_configure_video_storage.sql but was not
present in the database; a later change had replaced these policies without it.

## Fix
Recreate both write policies with the storage_path prefix binding restored.
This matches the paths the app actually writes
(`<user-id>/videos/<video-id>/<file-id>.<ext>`, see src/components/UploadModal.tsx),
so legitimate uploads are unaffected.

## Security
- A user can no longer create or point a video record at a path outside their
  own storage folder, closing both the signed-URL read and the public-exposure
  route.
*/

DROP POLICY IF EXISTS "videos_insert_own" ON public.videos;
CREATE POLICY "videos_insert_own"
ON public.videos FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = owner_id
  AND storage_path LIKE auth.uid()::text || '/%'
);

DROP POLICY IF EXISTS "videos_update_own" ON public.videos;
CREATE POLICY "videos_update_own"
ON public.videos FOR UPDATE TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (
  auth.uid() = owner_id
  AND storage_path LIKE auth.uid()::text || '/%'
);
