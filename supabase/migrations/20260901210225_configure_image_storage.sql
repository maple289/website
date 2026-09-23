/*
# Configure private image storage

Adds standalone photos and moves new video previews out of PostgreSQL into a
private bucket. Object paths always start with the immutable owner UUID.
*/

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'user-images',
  'user-images',
  false,
  26214400,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.videos
ADD COLUMN IF NOT EXISTS preview_path text;

DROP POLICY IF EXISTS "videos_insert_own" ON public.videos;
CREATE POLICY "videos_insert_own"
ON public.videos FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = owner_id
  AND storage_path LIKE auth.uid()::text || '/%'
  AND (
    preview_path IS NULL
    OR preview_path LIKE auth.uid()::text || '/video-previews/%'
  )
);

DROP POLICY IF EXISTS "videos_update_own" ON public.videos;
CREATE POLICY "videos_update_own"
ON public.videos FOR UPDATE TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (
  auth.uid() = owner_id
  AND storage_path LIKE auth.uid()::text || '/%'
  AND (
    preview_path IS NULL
    OR preview_path LIKE auth.uid()::text || '/video-previews/%'
  )
);

CREATE TABLE IF NOT EXISTS public.photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_email text,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  preview_path text NOT NULL,
  thumbnail_path text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  file_size bigint,
  mime_type text NOT NULL,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.photos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photos TO authenticated;
GRANT ALL ON public.photos TO service_role;

DROP POLICY IF EXISTS "photos_select_own" ON public.photos;
CREATE POLICY "photos_select_own"
ON public.photos FOR SELECT TO authenticated
USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "photos_select_public" ON public.photos;
CREATE POLICY "photos_select_public"
ON public.photos FOR SELECT TO anon, authenticated
USING (visibility = 'public');

DROP POLICY IF EXISTS "photos_select_admin" ON public.photos;
CREATE POLICY "photos_select_admin"
ON public.photos FOR SELECT TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "photos_insert_own" ON public.photos;
CREATE POLICY "photos_insert_own"
ON public.photos FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = owner_id
  AND storage_path LIKE auth.uid()::text || '/photos/%'
  AND preview_path LIKE auth.uid()::text || '/photos/%'
  AND thumbnail_path LIKE auth.uid()::text || '/photos/%'
);

DROP POLICY IF EXISTS "photos_update_own" ON public.photos;
CREATE POLICY "photos_update_own"
ON public.photos FOR UPDATE TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (
  auth.uid() = owner_id
  AND storage_path LIKE auth.uid()::text || '/photos/%'
  AND preview_path LIKE auth.uid()::text || '/photos/%'
  AND thumbnail_path LIKE auth.uid()::text || '/photos/%'
);

DROP POLICY IF EXISTS "photos_delete_own" ON public.photos;
CREATE POLICY "photos_delete_own"
ON public.photos FOR DELETE TO authenticated
USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_photos_owner_id ON public.photos(owner_id);
CREATE INDEX IF NOT EXISTS idx_photos_visibility ON public.photos(visibility);
CREATE INDEX IF NOT EXISTS idx_photos_created_at ON public.photos(created_at DESC);

DROP POLICY IF EXISTS "user_images_read_own" ON storage.objects;
CREATE POLICY "user_images_read_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'user-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "user_images_read_public" ON storage.objects;
CREATE POLICY "user_images_read_public"
ON storage.objects FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'user-images'
  AND (
    EXISTS (
      SELECT 1
      FROM public.photos photo
      WHERE photo.visibility = 'public'
        AND name IN (
          photo.storage_path,
          photo.preview_path,
          photo.thumbnail_path
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.videos video
      WHERE video.visibility = 'public'
        AND video.preview_path = name
    )
  )
);

DROP POLICY IF EXISTS "user_images_insert_own" ON storage.objects;
CREATE POLICY "user_images_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'user-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "user_images_update_own" ON storage.objects;
CREATE POLICY "user_images_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'user-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'user-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "user_images_delete_own" ON storage.objects;
CREATE POLICY "user_images_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'user-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
