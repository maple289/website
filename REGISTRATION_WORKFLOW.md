# Registration and first password setup

Registration submits username, email and optional profile names to
`notify-admin-registration`. A pending row is saved before administrator email
delivery starts. Recipients come from profiles with the `admin` role. Delivery
errors are recorded independently and never roll back a saved registration.

`ADMIN_NOTIFICATION_RECIPIENTS` optionally limits these recipients to a
comma-separated list of registered administrator addresses without changing their
account permissions. Production currently restricts this list to
`maple289@gmail.com`. An empty setting restores notifications to all registered
administrators.

`approve-registration` verifies the administrator session, then invokes
`approve_pending_account` using that session. The database function locks the
request, checks username/email conflicts, creates the Auth user and email identity,
sets the profile role to `user`, records activation state, verifies creation and
deletes the pending row. Any failure rolls back the complete transaction.
Legacy pending requests without a username use a sanitized email prefix; a
conflict is reported and the pending row is retained.

An approved account initially has a NULL password hash and a private activation
row with `must_change_password=true`. Blank login through `account-login` returns
only a random password-setup capability, never an authenticated session. Only its
SHA-256 hash is stored on the server, with a 15-minute expiry. The initial-password
page prevents normal navigation. The Auth access-token hook also blocks other
authentication methods until setup is complete.

Initial setup atomically claims the capability and uses the native Supabase Auth
password update to validate and hash the password. A database trigger clears the
setup flag and invalidates the capability in the password-update transaction.
The client then signs in normally. Blank login and token reuse are rejected after
setup. Subsequent changes use Settings and native Auth's current-password check.

## Deployment

Use `scripts/deploy.sh`, which applies database migrations before enabling the
Auth hooks. Deploy the frontend, Edge Functions and Auth compose override together.
The approval migration targets the project's pinned, self-hosted Supabase Auth
schema. Run the regression checks when upgrading Supabase.

Customer emails are temporarily suppressed in two places:

- `CUSTOMER_EMAILS_ENABLED=false` in the functions environment suppresses
  applicant messages while preserving templates and Resend code.
- `GOTRUE_HOOK_SEND_EMAIL_ENABLED=true` with the
  `suppress_customer_auth_email` hook suppresses native Auth emails.
  Password-change email notifications are also disabled explicitly.

To restore customer mail after fixing sender verification, enable the customer
email flag, disable the suppression hook, review the native Auth notification
settings, recreate the affected services and run a controlled delivery test.
Leave the access-token hook and current-password requirement enabled.

`RESEND_FROM_EMAIL` is a verified sending identity, not an administrator recipient
list. A Resend test sender can reject recipients other than the account owner.
Inspect the server-only delivery ledger for recipient-specific failures. Never
copy the Resend key into frontend settings or diagnostic output.

## Regression checks

- `npm run typecheck` and `npm run build`.
- `node scripts/test-registration-email.mjs`: actual email handlers with mocked
  Resend and local PGlite, including failure isolation, secret redaction and the
  customer-only suppression switch. Requires the existing PGlite installation at
  `.runtime/sharing-tests/node_modules/@electric-sql/pglite`.
- Run `scripts/test-registration-activation.sql` through `psql` with
  `ON_ERROR_STOP=1` after applying migrations. It uses an existing administrator,
  creates reserved regression fixtures in one transaction, and always rolls back
  on successful completion. A failed connection/transaction also rolls back.
  It checks approval, conflicts, roles, restricted token access, account bans,
  expiry, replay and completion state.

For a live test, use a specifically authorized disposable registration. Verify
the actual Admin Approve endpoint, blank login, forced setup, native password
hashing, subsequent login and authorization before removing any test records.
Do not print request passwords, session tokens, setup capabilities or API keys.
