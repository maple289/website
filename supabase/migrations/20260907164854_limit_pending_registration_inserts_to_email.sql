/*
# F4: Only allow the email column to be supplied on a registration request

## Problem
`anon_insert_pending_registrations` has `WITH CHECK (true)` and the table-wide
INSERT grant made every column insertable by `anon` and `authenticated`. A
visitor could post `status`, `reviewed_at` and `reviewed_by` directly, landing a
row in the Admin Console already presented as approved and attributed to an
administrator who never reviewed it.

## Fix
Revoke the table-wide INSERT grant from the client roles and re-grant INSERT on
the `email` column only. Every other column then falls back to its DEFAULT
('pending', now(), NULL). The signup form in src/context/AuthContext.tsx only
ever sends `{ email }`, so it is unaffected.

## Security
- Approval state can no longer be forged by the requester.
- SELECT/UPDATE/DELETE grants are untouched; RLS still governs those.
*/

REVOKE INSERT ON public.pending_registrations FROM anon;
REVOKE INSERT ON public.pending_registrations FROM authenticated;

GRANT INSERT (email) ON public.pending_registrations TO anon;
GRANT INSERT (email) ON public.pending_registrations TO authenticated;
