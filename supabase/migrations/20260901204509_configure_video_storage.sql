/*
# Configure private video storage

Creates the bucket used by the application and ensures that database records
can reference files only inside the authenticated user's storage folder.
*/

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'user-videos',
  'user-videos',
  false,
  10737418240,
  ARRAY['video/*']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

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
