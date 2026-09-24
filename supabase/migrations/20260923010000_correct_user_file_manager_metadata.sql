-- Follow-up for the File Manager schema. This migration is safe to apply after
-- the initial File Manager migration and also repairs partially created tables.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('user-files', 'user-files', false, 10737418240)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit;

ALTER TABLE public.user_file_metadata
  ADD COLUMN IF NOT EXISTS file_size bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trashed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Do not accept impossible metadata values from direct Data API clients.
ALTER TABLE public.user_file_metadata
  DROP CONSTRAINT IF EXISTS user_file_metadata_file_size_nonnegative,
  ADD CONSTRAINT user_file_metadata_file_size_nonnegative CHECK (file_size >= 0),
  DROP CONSTRAINT IF EXISTS user_file_metadata_folder_metadata_valid,
  ADD CONSTRAINT user_file_metadata_folder_metadata_valid CHECK (
    NOT is_folder OR (file_size = 0 AND mime_type = '')
  );

-- The browser may supply an updated_at value. Use the database clock for a
-- trustworthy Recent ordering and modified date instead.
CREATE OR REPLACE FUNCTION public.touch_user_file_metadata_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_user_file_metadata_updated_at ON public.user_file_metadata;
CREATE TRIGGER touch_user_file_metadata_updated_at
BEFORE INSERT OR UPDATE ON public.user_file_metadata
FOR EACH ROW EXECUTE FUNCTION public.touch_user_file_metadata_updated_at();

REVOKE ALL ON FUNCTION public.touch_user_file_metadata_updated_at() FROM PUBLIC;

CREATE INDEX IF NOT EXISTS user_file_metadata_recent
ON public.user_file_metadata(owner_id, updated_at DESC)
WHERE trashed_at IS NULL AND NOT is_folder;
