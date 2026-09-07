/*
# F6, F7, F10: Remove internal SECURITY DEFINER helpers from the public API

## Problem
Postgres grants EXECUTE to PUBLIC on every new function, and `anon` /
`authenticated` inherit from PUBLIC. That made three internal SECURITY DEFINER
helpers callable over `/rest/v1/rpc/...` by anyone holding the public anon key:

- `get_user_storage_folder(uuid)` (F6) reads `profiles.email` as definer, so it
  bypassed `profiles_select_own` and returned the email local-part of ANY user
  id supplied by the caller.
- `get_root_folder()` (F7) reads `app_config.root_folder`, a table whose only
  RLS policy restricts SELECT to `is_admin()`.
- `handle_new_user()` (F10) is a trigger routine that inserts into `profiles`
  and should never be part of the client-facing API surface.

## Fix
Revoke EXECUTE from PUBLIC, `anon` and `authenticated` on all three.

## Security
- `storage_path_belongs_to_user` calls `get_root_folder` and
  `get_user_storage_folder` from inside a SECURITY DEFINER context, and the
  `handle_new_user` trigger fires as the table owner, so all internal callers
  keep working. Only direct REST invocation is removed.
*/

REVOKE EXECUTE ON FUNCTION public.get_user_storage_folder(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_storage_folder(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_storage_folder(uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.get_root_folder() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_root_folder() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_root_folder() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
