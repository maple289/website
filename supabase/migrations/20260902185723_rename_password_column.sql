/*
# Rename password_hash column to password for pending registrations

The password_hash column was intended to store a bcrypt hash, but the Supabase Admin API's
createUser function expects a plaintext password. Since pending_registrations is a temporary
holding table (password is cleared after review), we rename the column to store the plaintext
password temporarily so it can be passed to createUser on approval.

1. Modified Tables
- `pending_registrations`: rename `password_hash` → `password` (text, not null)

2. Security
- No RLS policy changes. The column name change is internal.
- The password is cleared (set to empty string) immediately after the registration is approved or rejected.
*/
ALTER TABLE pending_registrations RENAME COLUMN password_hash TO password;
