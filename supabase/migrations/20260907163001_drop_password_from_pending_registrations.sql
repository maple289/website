/*
# Remove password column from pending_registrations

1. Security Fix
   - The `pending_registrations` table previously stored plaintext passwords temporarily
     so they could be passed to `auth.admin.createUser` on approval.
   - This is a security risk: plaintext passwords in the database, even temporarily,
     can be exposed if the database is compromised or through misconfigured RLS.
   - Going forward, registrations store ONLY the user's email address.
   - On approval, the admin edge function uses `auth.admin.inviteUserByEmail` to send
     the user an invitation email so they can set their own password. The server never
     sees or stores the password.

2. Modified Tables
   - `pending_registrations`: DROP COLUMN `password` (text, was previously `password_hash`)
     - This column is no longer needed and should not exist.
     - Any existing rows with a password value will have that data removed.

3. Security
   - No RLS policy changes needed.
   - The table still allows anon INSERT (for registration submissions) and
     authenticated SELECT (for admin console to list pending requests).
   - All status changes still go through the `approve-registration` edge function
     using the service role key.

4. Notes
   - This migration is safe to re-run: `DROP COLUMN IF EXISTS` is idempotent.
   - Existing pending registrations will lose their stored password, which is the
     intended behavior — those users will need to be re-invited via email.
*/

ALTER TABLE pending_registrations DROP COLUMN IF EXISTS password;
