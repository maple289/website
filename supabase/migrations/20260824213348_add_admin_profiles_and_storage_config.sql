/*
# Admin: user profiles with roles and storage location config

## Purpose
Adds an admin layer to the app:
1. A `profiles` table that mirrors auth users with a role column (user / admin).
2. A `storage_locations` table that records configured drives/folders available for file storage.

## New Tables

### profiles
- `id` (uuid, primary key, references auth.users) — one row per user
- `email` (text) — denormalized for admin list display
- `role` (text, default 'user') — 'user' or 'admin'
- `created_at` (timestamptz)

### storage_locations
- `id` (uuid, primary key)
- `label` (text) — friendly name e.g. "External Drive D"
- `path` (text) — folder path e.g. "D:\\Videos" or "/mnt/videos"
- `type` (text) — 'local' | 'network' | 'external'
- `enabled` (boolean, default true)
- `created_at` (timestamptz)

## Security
- RLS enabled on both tables.
- profiles: users can read their own profile. Admins can read all profiles.
  Writes (role changes) are done via a SECURITY DEFINER function so non-admins
  cannot escalate themselves; the function checks the caller is an admin.
- storage_locations: only admins can read/write. No anon access.

## Admin helper
- `is_admin()` SQL function returns true if the current user's profile role = 'admin'.
- `set_user_role(target uuid, new_role text)` SECURITY DEFINER function lets an
  admin promote/demote users safely.
- `promote_first_admin(email text)` SECURITY DEFINER function allows bootstrapping
  the very first admin from the Supabase SQL editor (call once).

## Important notes
1. After applying, promote your own account to admin using:
   `SELECT promote_first_admin('your-email@example.com');`
   from the SQL editor, or by inserting into profiles manually with role='admin'.
2. The `profiles` table is populated by a trigger on auth.users insert so new
   sign-ups automatically get a 'user' role row.
*/

-- ---------- profiles table ----------
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own"
ON profiles FOR SELECT TO authenticated
USING (auth.uid() = id);

-- Admins can read all profiles
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
CREATE POLICY "profiles_select_admin"
ON profiles FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- No direct INSERT/UPDATE/DELETE policies: writes go through SECURITY DEFINER functions.

-- ---------- storage_locations table ----------
CREATE TABLE IF NOT EXISTS storage_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  path text NOT NULL,
  type text NOT NULL DEFAULT 'local' CHECK (type IN ('local','network','external')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;

-- Only admins can manage storage locations
DROP POLICY IF EXISTS "storage_select_admin" ON storage_locations;
CREATE POLICY "storage_select_admin"
ON storage_locations FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "storage_insert_admin" ON storage_locations;
CREATE POLICY "storage_insert_admin"
ON storage_locations FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "storage_update_admin" ON storage_locations;
CREATE POLICY "storage_update_admin"
ON storage_locations FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "storage_delete_admin" ON storage_locations;
CREATE POLICY "storage_delete_admin"
ON storage_locations FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ---------- helper: is_admin() ----------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- ---------- helper: set_user_role ----------
CREATE OR REPLACE FUNCTION set_user_role(target uuid, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;
  IF new_role NOT IN ('user','admin') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  UPDATE profiles SET role = new_role WHERE id = target;
END;
$$;

GRANT EXECUTE ON FUNCTION set_user_role(uuid, text) TO authenticated;

-- ---------- helper: promote_first_admin (bootstrap only) ----------
CREATE OR REPLACE FUNCTION promote_first_admin(admin_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id uuid;
BEGIN
  SELECT id INTO found_id FROM profiles WHERE email = admin_email;
  IF found_id IS NULL THEN
    RAISE EXCEPTION 'No profile found with email %', admin_email;
  END IF;
  UPDATE profiles SET role = 'admin' WHERE id = found_id;
END;
$$;

GRANT EXECUTE ON FUNCTION promote_first_admin(text) TO authenticated;

-- ---------- trigger: auto-create profile on signup ----------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
