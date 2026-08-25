/*
# Fix infinite recursion in profiles RLS policies

## Problem
The `profiles_select_admin` policy used a subquery against `profiles` inside
the policy on `profiles`, causing infinite recursion (Postgres error 42P17).

## Fix
Replace the inline subquery with the existing `is_admin()` SECURITY DEFINER
function, which reads profiles outside of RLS context. Also update the
storage_locations policies the same way for consistency and to avoid the
same trap.

## Security
- No change to access semantics: only admins can read all profiles / storage
  locations. Users can still read their own profile.
*/

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;

CREATE POLICY "profiles_select_own"
ON profiles FOR SELECT TO authenticated
USING (auth.uid() = id);

CREATE POLICY "profiles_select_admin"
ON profiles FOR SELECT TO authenticated
USING (is_admin());

DROP POLICY IF EXISTS "storage_select_admin" ON storage_locations;
DROP POLICY IF EXISTS "storage_insert_admin" ON storage_locations;
DROP POLICY IF EXISTS "storage_update_admin" ON storage_locations;
DROP POLICY IF EXISTS "storage_delete_admin" ON storage_locations;

CREATE POLICY "storage_select_admin"
ON storage_locations FOR SELECT TO authenticated
USING (is_admin());

CREATE POLICY "storage_insert_admin"
ON storage_locations FOR INSERT TO authenticated
WITH CHECK (is_admin());

CREATE POLICY "storage_update_admin"
ON storage_locations FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "storage_delete_admin"
ON storage_locations FOR DELETE TO authenticated
USING (is_admin());
