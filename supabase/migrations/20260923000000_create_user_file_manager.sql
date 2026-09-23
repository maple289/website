-- Private per-user file storage used by the in-app File Manager.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('user-files', 'user-files', false, 10737418240)
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "user_files_select_own" ON storage.objects;
CREATE POLICY "user_files_select_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "user_files_insert_own" ON storage.objects;
CREATE POLICY "user_files_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "user_files_update_own" ON storage.objects;
CREATE POLICY "user_files_update_own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "user_files_delete_own" ON storage.objects;
CREATE POLICY "user_files_delete_own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE TABLE IF NOT EXISTS public.user_file_metadata (
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  object_path text NOT NULL,
  is_folder boolean NOT NULL DEFAULT false,
  is_favorite boolean NOT NULL DEFAULT false,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT '',
  trashed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, object_path),
  CHECK (object_path LIKE owner_id::text || '/%')
);

ALTER TABLE public.user_file_metadata ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_file_metadata TO authenticated;

DROP POLICY IF EXISTS "user_file_metadata_own" ON public.user_file_metadata;
CREATE POLICY "user_file_metadata_own" ON public.user_file_metadata
FOR ALL TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id AND object_path LIKE auth.uid()::text || '/%');

CREATE INDEX IF NOT EXISTS user_file_metadata_favorites
ON public.user_file_metadata(owner_id, is_favorite) WHERE is_favorite;
CREATE INDEX IF NOT EXISTS user_file_metadata_trash
ON public.user_file_metadata(owner_id, trashed_at) WHERE trashed_at IS NOT NULL;
