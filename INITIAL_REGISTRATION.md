# First registration and temporary password

1. Applicant submits their email and optional first/last name.
2. An administrator approves the request; account creation remains atomic.
3. The approval email includes a random-looking, cryptographically secure
   12-character temporary password and its expiration time (UTC).
4. Applicant uses the usual Email and Password fields, then creates and confirms
   a different permanent password before receiving a normal authenticated session.
5. Future logins use the permanent password.

The temporary password expires exactly one hour after database issuance. It
cannot be made permanent by saving the same password. Successful permanent
password creation clears temporary credentials and setup capabilities.

An approved applicant whose email is missing or expired can choose **Request
temporary password** on Sign in. Requests have an account cooldown and a global
server quota. Replacement invalidates the previous temporary password and setup
capability. Wrong credentials have a server-side ten-attempt limit; requesting a
replacement starts a new limited credential. The public response does not reveal
whether an account exists or is approved.

Only SHA-256 hashes of temporary credentials and setup capabilities are stored.
The temporary password is not installed as a normal Auth password, so alternate
Auth APIs cannot bypass its expiration or the mandatory permanent-password step.
The setup capability is returned only after correct credential verification,
kept in frontend memory, and expires with the original temporary credential.
After refresh, the applicant signs in again with the still-valid temporary password.

Approval delivery uses the existing private email ledger and provider idempotency.
The persisted template has no password. A purpose-bound HMAC of the random
delivery ID with the existing private service credential derives the same
72-bit password for Edge and worker retries. The server preserves the original
expiry on retries and does not let an old approval delivery replace a newer
applicant-requested password. Plaintext is added only to the provider request;
it is removed from provider error logs before truncation.

Approval credential delivery is essential mail and is sent even when optional
customer notifications are suppressed. Existing Resend sender/key configuration
is required; no new secret configuration is needed. A failed delivery retains
the approved account and safe retry diagnostics. The deployment restarts the
bound email-worker script so the new retry logic is loaded.

Migration: `20261012050000_initial_temporary_password.sql`. Old blank-password
issuance is retired; already-issued mailbox setup capabilities can finish within
their existing expiration. Existing active accounts keep ordinary password login.

Validation uses actual SQL/Edge handlers and intercepted provider requests,
plus real frontend/auth-client browser fixtures at desktop/tablet/mobile sizes.
No production applicant, password or external email is used in the regressions.
