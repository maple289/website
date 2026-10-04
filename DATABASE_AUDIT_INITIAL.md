# Database audit: findings before changes

Inspected October 3, 2026. Production data has not been repaired or deleted.

## Architecture and observed state

- PostgreSQL 17.6, self-hosted Supabase; the application uses supabase-js,
  PostgREST, Storage APIs and SQL functions, without an ORM.
- 58 tables across public, auth, storage and streamly_internal; 24 application
  tables. The read-only inventory captures every column, nullability, default,
  primary/foreign/check/unique constraint, index, policy and application trigger.
- Videos/photos reference Auth owners; reaction generated columns reference the
  correct media table. Shares reference recipient profiles and file metadata.
  Analytics source/event/viewer relationships cascade. Preview jobs reference
  Storage objects; media jobs reference owners and, for custom previews, videos.
- No foreign-key violations, duplicate normalized Auth emails, missing profiles,
  password/activation contradictions, negative counters or view-counter drift
  were found in the initial live snapshot.
- Registration snapshots and email-delivery records intentionally outlive the
  consumed pending registration; absence of that foreign key is intentional.
- Folder hierarchy is represented by object paths, not parent ID relationships.
  Cycles must therefore be prevented through canonical paths and move validation.

## Suspected problems requiring isolated reproduction

1. **File metadata and Storage changes commit separately.** There is no database
   relationship tying a metadata row to a Storage object. A failure between a
   move/upload and the subsequent metadata request may break shares, search or
   folder listings. The upload catch can remove a newly uploaded object after an
   ambiguous metadata response without confirming whether its metadata committed.
2. **Worker publication lacks a fenced claim.** Job claiming uses conditional
   queued-to-processing updates, but publication and status updates do not carry
   a claim identity. Stale recovery/retry may allow a delayed old worker to affect
   a newer attempt. Ambiguous Storage/record responses require reconciliation.
3. **Missing state constraints.** Pending-registration status has no CHECK, and
   upload-job kind/target/result consistency is mostly enforced in code. Ready
   media has no constraint establishing a playable reference exists in Storage.
   A foreign key alone cannot prove physical bytes are present.
4. **Migration transaction boundaries.** The runner wraps each migration and its
   ledger entry in BEGIN/COMMIT, but several deployed migrations contain their own
   BEGIN/COMMIT. PostgreSQL does not nest these transactions; an internal COMMIT
   can separate schema changes from the migration ledger.
5. **Admin account edits span Auth and profile requests.** Interrupted email/role
   updates and account creation need failure tests to detect partially applied
   profile changes. Existing production profile emails currently match Auth.
6. **Physical storage needs classification.** The initial scan found an
   unreferenced catalog object and files absent from the catalog. Many apparent
   extra files are TUS JSON upload receipts rather than media. Three legacy ready
   videos use the original-file fallback and require probing before classification.

These are audit findings, not permission to discard any existing data. Structural
corrections will use new migrations, a verified backup and isolated regression
tests. The read-only checker never repairs or deletes objects.

## Confirmed isolated findings

- Last-admin demotion succeeds: the local variable `current_role` conflicts with
  PostgreSQL's `CURRENT_ROLE` expression, so its comparison never sees `admin`.
- Correctly classified live storage: 15 TUS receipts, one unreferenced catalog
  object and one 48 MiB payload without a catalog entry. These remain untouched.
