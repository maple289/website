/*
# Secure administrator role management

Removes the public admin-bootstrap path, backfills profiles for existing auth
users, and prevents the final administrator from being demoted.
*/

-- Users created before the profile trigger was installed still need profiles.
INSERT INTO public.profiles AS existing (id, email)
SELECT id, email
FROM auth.users
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email
WHERE existing.email IS DISTINCT FROM EXCLUDED.email;

-- Bootstrap is allowed only while no administrator exists. The function is
-- intentionally unavailable through the Supabase API and must be called by the
-- database owner from the SQL editor or psql.
CREATE OR REPLACE FUNCTION public.promote_first_admin(admin_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'An administrator already exists';
  END IF;

  SELECT id
  INTO found_id
  FROM public.profiles
  WHERE lower(email) = lower(admin_email)
  LIMIT 1;

  IF found_id IS NULL THEN
    RAISE EXCEPTION 'No profile found with email %', admin_email;
  END IF;

  UPDATE public.profiles
  SET role = 'admin'
  WHERE id = found_id;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_first_admin(text)
FROM PUBLIC, anon, authenticated, service_role;

-- Only an authenticated administrator may change roles. Serializing role
-- changes prevents concurrent requests from demoting every administrator.
CREATE OR REPLACE FUNCTION public.set_user_role(target uuid, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  IF new_role NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

  SELECT role
  INTO current_role
  FROM public.profiles
  WHERE id = target;

  IF current_role IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF current_role = 'admin'
     AND new_role = 'user'
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE role = 'admin' AND id <> target
     ) THEN
    RAISE EXCEPTION 'The last administrator cannot be demoted';
  END IF;

  UPDATE public.profiles
  SET role = new_role
  WHERE id = target;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_role(uuid, text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin()
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user()
FROM PUBLIC, anon, authenticated, service_role;
