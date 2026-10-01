# Registration and first password setup

Registration submits email and optional profile names to
`notify-admin-registration`. A pending row is saved before administrator email
delivery starts. Recipients come from profiles with the `admin` role. Delivery
errors are recorded independently and never roll back a saved registration.

The backend checks for an existing account before saving a request. It returns
HTTP 409 with `EMAIL_ALREADY_REGISTERED`, `REGISTRATION_ALREADY_PENDING` or
`REGISTRATION_ALREADY_REVIEWED` when the address is already in use. The form
displays a warning, retains the entered fields and allows another email to be
submitted. Successful new requests disable repeat submission.
Existing accounts and reviewed requests receive no new notifications. A duplicate
pending request may retry unsent notifications through the existing delivery
ledger, without creating another request or duplicating accepted emails. A rejected
request keeps its administrator decision; reopening it requires an explicit
administrator decision.

`ADMIN_NOTIFICATION_RECIPIENTS` optionally limits these recipients to a
comma-separated list of registered administrator addresses without changing their
account permissions. Production currently restricts this list to
`maple289@gmail.com`. An empty setting restores notifications to all registered
administrators.

`approve-registration` verifies the administrator session, then invokes
`approve_pending_account` using that session. The database function locks the
request, checks email conflicts, creates the Auth user and email identity,
sets the profile role to `user`, records activation state, verifies creation and
deletes the pending row. Any failure rolls back the complete transaction.
Email is the login identifier. A conflict is reported and the pending row is retained.
The private activation record also makes repeated approvals idempotent after the
pending row is removed, without recreating the account or changing its password.

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

Registration notifications use the existing Resend service:

- `CUSTOMER_EMAILS_ENABLED=true` enables only `registration_receipt` and
  `registration_approved`. Set it to `false` to suppress these messages while
  preserving administrator notifications. Rejection and unrelated customer
  notifications remain suppressed.
- `RESEND_API_KEY` stays in the backend environment, never the frontend.
- `RESEND_FROM_EMAIL=noreply@myhostage.ca`, `RESEND_FROM_NAME=MyHostage`,
  `SITE_NAME=MyHostage`, and `SITE_URL=https://myhostage.ca/video/` configure the
  sender, branding and website links. The sending domain must be verified in Resend.
- Both customer templates contain responsive HTML and plain text. The approval
  link opens the existing sign-in dialog at `https://myhostage.ca/video/#/login`.
- `GOTRUE_HOOK_SEND_EMAIL_ENABLED=true` with the
  `suppress_customer_auth_email` hook still suppresses unrelated native Auth emails.
  Password-change email notifications are also disabled explicitly.

Do not disable the Auth suppression/access-token hooks to enable registration
notifications. These notifications are delivered by the registration endpoints,
independently of Auth. Recreate Functions after environment changes and run a
controlled delivery test. Email failures never roll back registration or approval.

The private delivery ledger retains the HTML, plain text, sender, status and safe
diagnostic information. Its unique key and atomic claim prevent duplicate sends.
Retries use the same payload and Resend idempotency key. A repeated authenticated
approval can recover a failed notification using the activation record even after
the pending request has been removed. There is no recurring retry worker; inspect
failed deliveries before a deliberate retry. Do not reset ambiguous attempts
older than the existing 23-hour retry window.

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
- `node scripts/test-registration-email-layout.mjs` checks both templates at
  320, 390, 768 and 1440px, including long names and valid login links. It uses
  Playwright, with optional `PLAYWRIGHT_MODULE` and `BROWSER_CHANNEL` overrides.
- Run `scripts/test-registration-activation.sql` through `psql` with
  `ON_ERROR_STOP=1` after applying migrations. It uses an existing administrator,
  creates reserved regression fixtures in one transaction, and always rolls back
  on successful completion. A failed connection/transaction also rolls back.
  It checks approval, conflicts, roles, restricted token access, account bans,
  expiry, replay and completion state.
- `scripts/test-registration-notifications.sql` exercises the current email-only
  approval RPC, idempotent approvals, role/password state and private metadata in
  a transaction that rolls back all fixtures.

For a live test, use a specifically authorized disposable registration. Verify
the actual Admin Approve endpoint, blank login, forced setup, native password
hashing, subsequent login and authorization before removing any test records.
Do not print request passwords, session tokens, setup capabilities or API keys.
