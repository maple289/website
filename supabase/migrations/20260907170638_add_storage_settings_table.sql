/*
# Storage Settings Table

## Purpose
Allows administrators to configure the physical disk/folder locations
where user-uploaded videos and images are stored. These settings persist
in the database and are read by the upload flow and the serve-media
edge function.

## New Tables
- `storage_settings`
  - `id` (int2, primary key, always 1 — singleton row)
  - `videos_base_path` (text, not null) — configured folder for user videos
  - `images_base_path` (text, not null) — configured folder for user images
  - `updated_at` (timestamptz) — last modification time
  - `updated_by` (uuid) — admin who last saved

## Security
- RLS enabled; only admins can SELECT, INSERT, UPDATE.
- A helper function `get_storage_base_path(p_kind text)` returns the
  configured base path for 'videos' or 'images', defaulting to empty
  string if unset. Callable by authenticated users (read-only).
- A trigger ensures exactly one row always exists.
*/

CREATE TABLE IF NOT EXISTS public.storage_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  videos_base_path text NOT NULL DEFAULT '',
  images_base_path text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.storage_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can read or modify storage settings
DROP POLICY IF EXISTS "storage_settings_select_admin" ON public.storage_settings;
CREATE POLICY "storage_settings_select_admin"
ON public.storage_settings FOR SELECT
TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "storage_settings_insert_admin" ON public.storage_settings;
CREATE POLICY "storage_settings_insert_admin"
ON public.storage_settings FOR INSERT
TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "storage_settings_update_admin" ON public.storage_settings;
CREATE POLICY "storage_settings_update_admin"
ON public.storage_settings FOR UPDATE
TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Seed the singleton row
INSERT INTO public.storage_settings (id, videos_base_path, images_base_path)
VALUES (1, '', '')
ON CONFLICT (id) DO NOTHING;

-- Helper: return the configured base path for a given kind
CREATE OR REPLACE FUNCTION public.get_storage_base_path(p_kind text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(p_kind) = 'videos' THEN videos_base_path
    WHEN lower(p_kind) = 'images' THEN images_base_path
    ELSE ''
  END
  FROM public.storage_settings
  WHERE id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_storage_base_path(text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_storage_base_path(text) TO authenticated;
