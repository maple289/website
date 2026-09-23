/*
# F3: Restrict the registration queue to administrators

## Problem
`authenticated_select_pending_registrations` used `USING (true)`, so any signed-in
user could call `GET /rest/v1/pending_registrations?select=*` and harvest every
applicant's email address, approval status and reviewing admin. The original
migration assumed an edge function would filter, but the Data API is reachable
directly and no function sits in front of this read.

## Fix
Replace the predicate with `is_admin()`.

## Security
- Only administrators can list registration requests.
- src/components/AdminPage.tsx reads this table only from the Admin Console,
  which is admin-only, so the console keeps working.
*/

DROP POLICY IF EXISTS "authenticated_select_pending_registrations" ON public.pending_registrations;
CREATE POLICY "authenticated_select_pending_registrations"
ON public.pending_registrations FOR SELECT
TO authenticated
USING (public.is_admin());
