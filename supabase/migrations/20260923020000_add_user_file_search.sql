-- Indexed, owner-scoped search for the File Manager. The browser searches this
-- metadata index instead of walking every storage prefix.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS user_file_metadata_name_search
ON public.user_file_metadata
USING gin ((lower(regexp_replace(object_path, '^.*/', ''))) extensions.gin_trgm_ops)
WHERE trashed_at IS NULL;

CREATE OR REPLACE FUNCTION public.search_user_files(
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  object_path text,
  name text,
  location text,
  is_folder boolean,
  file_size bigint,
  mime_type text,
  updated_at timestamptz,
  is_favorite boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH query AS (
    SELECT replace(
      replace(
        replace(lower(trim(p_query)), E'\\', E'\\\\'),
        '%', E'\\%'
      ),
      '_', E'\\_'
    ) AS value
  ), entries AS (
    SELECT
      metadata.object_path,
      substr(metadata.object_path, length(auth.uid()::text) + 2) AS relative_path,
      metadata.is_folder,
      metadata.file_size,
      metadata.mime_type,
      metadata.updated_at,
      metadata.is_favorite
    FROM public.user_file_metadata AS metadata
    WHERE metadata.owner_id = auth.uid()
      AND metadata.trashed_at IS NULL
  )
  SELECT
    entries.object_path,
    regexp_replace(entries.relative_path, '^.*/', '') AS name,
    CASE
      WHEN position('/' IN entries.relative_path) = 0 THEN ''
      ELSE regexp_replace(entries.relative_path, '/[^/]+$', '')
    END AS location,
    entries.is_folder,
    entries.file_size,
    entries.mime_type,
    entries.updated_at,
    entries.is_favorite
  FROM entries, query
  WHERE query.value <> ''
    AND lower(regexp_replace(entries.object_path, '^.*/', ''))
      LIKE '%' || query.value || '%' ESCAPE E'\\'
  ORDER BY entries.updated_at DESC, entries.relative_path ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 101)
  OFFSET GREATEST(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.search_user_files(text, integer, integer)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_user_files(text, integer, integer)
TO authenticated;
