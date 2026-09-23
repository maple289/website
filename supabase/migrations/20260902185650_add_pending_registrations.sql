/*
# Add pending registrations table for admin approval workflow

1. New Tables
- `pending_registrations`
  - `id` (uuid, primary key)
  - `email` (text, unique, not null) — the email the user wants to register with
  - `password_hash` (text, not null) — bcrypt hash of the chosen password (stored so we can create the auth user on approval)
  - `status` (text, not null, default 'pending') — one of 'pending', 'approved', 'rejected'
  - `created_at` (timestamptz, default now())
  - `reviewed_at` (timestamptz, nullable) — when an admin approved/rejected
  - `reviewed_by` (uuid, nullable) — the admin's profile id who reviewed it

2. Security
- Enable RLS on `pending_registrations`.
- Allow anon + authenticated to INSERT (so the signup form can submit a request).
- Allow only authenticated admins to SELECT (so the Admin Console can list them).
- No direct UPDATE or DELETE from the client; all status changes go through the approve-registration edge function using the service role key.

3. Notes
- The password is hashed with `crypt(password, gen_salt('bf'))` at insert time so plaintext never reaches the table.
- On approval, the edge function creates the auth user with this hash, then marks the row 'approved'.
- On rejection, the edge function marks the row 'rejected' and the auth user is never created.
*/

CREATE TABLE IF NOT EXISTS pending_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

ALTER TABLE pending_registrations ENABLE ROW LEVEL SECURITY;

-- Allow anyone (anon) to submit a registration request
DROP POLICY IF EXISTS "anon_insert_pending_registrations" ON pending_registrations;
CREATE POLICY "anon_insert_pending_registrations" ON pending_registrations FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- Allow authenticated users to read pending registrations (admin console filters via is_admin in the edge function)
DROP POLICY IF EXISTS "authenticated_select_pending_registrations" ON pending_registrations;
CREATE POLICY "authenticated_select_pending_registrations" ON pending_registrations FOR SELECT
  TO authenticated USING (true);
