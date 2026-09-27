# Email-only authentication and database review

## Read-only production inspection (2026-09-27)

Scope: registration, profiles, approval/activation, and registration email records.

- profiles.username: 0 populated values across 3 profiles.
- pending_registrations.username: 0 populated values across 3 requests.
- No duplicate case-insensitive, trimmed emails among non-deleted Auth accounts.
- Four database functions referenced username: approve_pending_account,
  start_initial_login, resolve_login_email, and protect_username.

The new migration replaces the three workflow functions with email-only versions,
then removes the obsolete username guard, columns, and their indexes/constraints.
It locks the relevant tables and refuses removal if legacy username data exists.
Unexpected dependencies stop the migration (no CASCADE).

## Retained fields

- Profile email and Auth email: profile display/admin notifications and canonical
  authentication identity respectively; neither is an unused duplicate.
- First/last names: optional profile editing, admin review and reaction display.
- Pending status/reviewed_at/reviewed_by: rejection and approval audit workflow.
- Activation flags, token hashes, expirations and claim timestamps: restricted
  first-login password setup, replay protection and throttling.
- Registration snapshot/approval metadata: approval audit record after the pending
  row is removed; not unused simply because it is not displayed in the UI.
- Email-delivery records: retries, delivery diagnostics and audit history.
- Supabase-managed auth fields: owned by Auth; not candidates for application cleanup.

No other fields in this authentication scope were confirmed unused. This review
is not a claim that all media/storage tables have been audited for unused columns.

## Integration

Registration uses optional First Name, optional Last Name and required Email.
Login accepts email only, including restricted initial blank-password login.
Email comparison remains case-insensitive. Existing password hashes, user IDs,
roles, sharing, activation restrictions and email configuration are preserved.
HTML autocomplete=username remains on the email sign-in input: it is the standard
password-manager token, not a separate database field or visible username input.

Deploy frontend, account-login, notify-admin-registration, approve-registration,
and migration 20260927120000_email_only_login.sql together in a maintenance window.
Older frontend/admin code selects username and must not remain active after the
column removal. The migration is prepared locally, not applied to production.
No live users or pending requests were changed during this inspection.
