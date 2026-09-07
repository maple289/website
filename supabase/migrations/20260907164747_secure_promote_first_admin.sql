/*
# F1: Close the unauthenticated privilege-escalation RPC

## Problem
`public.promote_first_admin(admin_email text)` is SECURITY DEFINER and, because
Postgres grants EXECUTE to PUBLIC on every new function, it was callable over
`/rest/v1/rpc/promote_first_admin` by the `anon` and `authenticated` roles with
no authorization check whatsoever. Any visitor holding the public anon key could
promote an arbitrary account to `admin`.

## Fix
1. Add a guard so the function refuses to run once any admin already exists,
   preserving its legitimate one-time bootstrap use from the deploy script.
2. Revoke EXECUTE from PUBLIC, `anon` and `authenticated` so it is no longer
   reachable through the Data API at all. `service_role` and `postgres` retain
   access, which is what `scripts/promote-first-admin.sh` uses.

## Security
- Not reachable from any browser client after this change.
- Idempotent bootstrap on a fresh database is unaffected.
*/

CREATE OR REPLACE FUNCTION public.promote_first_admin(admin_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  found_id uuid;
  admin_count int;
BEGIN
  SELECT count(*) INTO admin_count FROM profiles WHERE role = 'admin';
  IF admin_count > 0 THEN
    RAISE EXCEPTION 'An administrator already exists; use set_user_role instead';
  END IF;

  SELECT id INTO found_id FROM profiles WHERE email = admin_email;
  IF found_id IS NULL THEN
    RAISE EXCEPTION 'No profile found with email %', admin_email;
  END IF;

  UPDATE profiles SET role = 'admin' WHERE id = found_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.promote_first_admin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_first_admin(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.promote_first_admin(text) FROM authenticated;
