/*
# Add File Storage Server URL to Storage Settings

## Purpose
Adds a new column to the `storage_settings` table so administrators can
configure an external file server URL. When a registered user clicks
"File Storage" in the sidebar, this URL is opened in a new tab.

## Changes
1. New column on `storage_settings`:
   - `file_server_url` (text, not null, default '') — the URL or IP address
     of the external file server configured by the administrator.

2. New helper function:
   - `get_file_server_url()` — returns the configured file server URL.
     Callable by any authenticated user (read-only), so the frontend can
     fetch the URL without admin privileges.

## Security
- The existing RLS policies on `storage_settings` already restrict
  SELECT/INSERT/UPDATE to admins only. No policy changes needed.
- The new `get_file_server_url()` function is SECURITY DEFINER so it can
  read the singleton row on behalf of non-admin authenticated users.
*/

ALTER TABLE public.storage_settings
  ADD COLUMN IF NOT EXISTS file_server_url text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.get_file_server_url()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT file_server_url FROM public.storage_settings WHERE id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_file_server_url() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_file_server_url() TO authenticated;
