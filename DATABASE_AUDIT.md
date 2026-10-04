# Database and storage integrity audit

Audit date: October 3–4, 2026. Existing application behavior and stored content are
preserved. Findings were recorded in `DATABASE_AUDIT_INITIAL.md` before changes.
No automatic repair or deletion of existing unmatched storage was performed.

## 1. Actual architecture

The production database is PostgreSQL **17.6**, running self-hosted Supabase.
The application uses supabase-js, PostgREST, Auth, Storage, SQL functions and
Python workers; there is no ORM. The inspected schemas contain **58 tables**,
including **24 application tables**. The private inventory records actual column
types, nullability, defaults, primary/foreign/check/unique constraints, indexes,
RLS policies, triggers, function grants and migration history.

| Area | Existing application tables |
| --- | --- |
| Accounts and approvals | `profiles`, `account_activation`, `pending_registrations`, `registration_email_deliveries` |
| Media and processing | `videos`, `photos`, `media_upload_jobs`, `video_deletions` |
| Files, sharing and previews | `user_file_metadata`, `user_file_shares`, `file_preview_jobs`, `file_preview_cleanup` |
| Reactions | `media_reactions` |
| Analytics | `analytics_content`, `analytics_events`, `analytics_viewers`, `analytics_activity`, `analytics_user_activity`, `analytics_cache`, `analytics_config`, `analytics_storage_snapshot` |
| Configuration | `app_config`, `storage_locations`, `storage_settings` |

Auth owners, media reactions, shares, preview sources and analytics have existing
foreign keys and applicable cascades. Reaction uniqueness is already enforced.
Registration/email delivery snapshots intentionally survive consumption of a
pending request. Folders use canonical object paths rather than parent-ID trees.
Account deletion does **not** automatically delete uploaded storage objects.

The live migration ledger includes one historical manual entry,
`20261001000000`, without a corresponding repository SQL file. It was preserved.
The repository migrations were checked separately for fresh/upgrade equivalence.

## 2. Confirmed problems and corrections

| Problem | Why it could occur | Correction |
| --- | --- | --- |
| Last administrator could be demoted | PL/pgSQL variable `current_role` conflicted with PostgreSQL's `CURRENT_ROLE` expression. Reproduced in isolated PostgreSQL. | Rename the variable, serialize role changes and recheck the caller after acquiring the lock. |
| Admin-created account/profile or email could diverge | Auth mutation and subsequent profile mutation were separate requests. Real GoTrue testing also showed that app metadata is written after the initial user insert. | Initialize names/role inside the Auth transaction, including its first app-metadata update; synchronize profile email through an Auth trigger. Later role edits retain the protected role RPC. |
| Case variants of a login email were insufficiently constrained | Supabase's built-in email uniqueness is case-sensitive. | Add normalized profile-email uniqueness; Auth creation/email updates trigger it within the same transaction. |
| Migration schema and ledger could commit separately | Existing migrations contain their own `BEGIN`/`COMMIT` inside the runner's wrapper; PostgreSQL transactions do not nest. | Normalize only top-level wrappers and execute migration plus ledger entry inside one locked transaction. Existing deployed SQL files are unchanged. |
| File upload/move could leave stale metadata or shares | Storage and client metadata updates committed separately; an ambiguous response could trigger deletion of an upload that had committed. | Synchronize future catalog changes and metadata in a database trigger; add a catalog foreign key; remove the later upload registration/rollback request. |
| Large file metadata listings could truncate | The old unpaged query hit PostgREST's row limit and loaded unrelated folders. | Add authenticated, folder-scoped paged metadata and own-storage aggregate RPCs. |
| Delayed video worker could publish after expiry/retry | Processing attempts had no fenced claim identity. | Claim tokens, locked claiming, stale recovery and atomic publication tied to the current claim. |
| Lost worker response could delete published files | Storage/publication success was not always distinguishable from response loss. | Recover committed status; retain uncertain files; use conditional error updates and bounded cleanup of new unpublished failures only. |
| Lost Office preview response could delete a valid cache | The Ready transaction could have committed before the response was lost. | Reconcile Ready status and serialize failure handling before removing an unpublished cache. |

## 3. New schema changes

Only four new migrations were added:

- `20261003120000_account_integrity.sql`: Auth/profile synchronization,
  transactional account initialization, corrected role function,
  `profiles_login_email_unique` and validated pending-status CHECK.
- `20261003130000_file_catalog_integrity.sql`: nullable metadata `source_id`
  referencing `storage.objects(id) ON DELETE CASCADE`, a partial unique index,
  catalog/metadata synchronization and canonical-path guards, plus scoped RPCs.
- `20261003140000_media_job_integrity.sql`: `claim_token`,
  `integrity_version`, validated job-kind/target CHECK, stale-job partial index,
  service-only claim/publication/cleanup RPCs.
- `20261003150000_auth_profile_role_initialization.sql`: finish initial
  server-selected administrator role assignment when GoTrue first writes app
  metadata; ignore client-writable metadata and preserve later protected role
  changes. This correction was identified by real Auth HTTP tests.

Existing file metadata is deliberately not backfilled. Existing media jobs receive
integrity version 0; automatic compensation is limited to new version 1 failures.
No soft deletion, deletion analytics, global filename uniqueness, duplicated
analytics counters or destructive schema changes were introduced.

Publication verifies expected owner, visibility, job paths and nonempty Storage
catalog entries **after** successful decoding and final-file uploads. The media
record and Complete job state commit together. Catalog checks alone cannot prove
physical bytes exist; actual decoders and the read-only disk checker cover that
separately.

## 4. Tests performed

All listed final runs passed. Database tests use a schema-only PostgreSQL 17.6
clone with synthetic accounts, no production data, no network and no production
storage mounts. HTTP/browser tests use intercepted fixture APIs.

| Test suite | Final result and scope |
| --- | --- |
| `tests/database-integrity.py` | **12 workflow tests:** concurrent approval, rollback, email uniqueness, first-password state, roles, ownership, visibility, sharing, reactions, concurrent view increments, own/admin statistics separation, previews, cancellation/deletion, catalog synchronization and fenced publication. |
| `tests/migration-integrity.py` | **5 checks:** all **53** repository migrations replay; repeat execution; injected SQL rollback; concurrent runners; fresh/upgraded effective application schema equivalence. |
| `tests/auth-integrity.py` | **11 real GoTrue HTTP checks:** profile/role creation, demotion preservation, restricted initial setup, actual Auth hashing, new/old/blank-password login, current-password enforcement, metadata privilege protection, email synchronization and disabled-account token denial. Uses the installed Auth version in the isolated database's loopback namespace. |
| `tests/migration-preparation.py` | **4 tests:** quoted SQL preservation, wrapper parsing, rejection and ledger locking. |
| Media decoder validation | **30 checks:** real image/video decoding and conversion, corrupt/disguised/wrong-category inputs, verified MP4 output and thumbnails. Video containers included MP4, MOV, AVI, MKV, WMV, WebM, MPEG, M4V, 3GP, TS/MTS/M2TS, OGV, FLV and NUT. |
| Media worker fault tests | **13 tests:** cancellation, decoder/permission/disk failures, publication ordering, lost claims/responses, safe temporary cleanup and restart scratch cleanup. |
| Office conversion and preview safety | **3 real DOCX/XLSX/PPTX conversions**, unchanged source hashes; **12 security checks**; **5 preview-worker response/failure tests**. |
| Interruption tests | **2 checks:** SIGKILL/restart of an isolated PostgreSQL container preserves committed data and rolls back unfinished writes; real FFmpeg output failure on a 1 MiB isolated tmpfs is cleaned up. |
| Read-only storage checker | **2 tests:** mismatch classification/path safety and proof that source files are unchanged. |
| Analytics collector | **5 tests:** capacity sampling, caching, paging and filesystem error handling. |
| Registration handlers/email layouts | **65 handler checks**, **9 layout checks**, and browser registration checks at desktop/tablet/mobile sizes. No real test emails sent by these suites. |
| Upload UI | **55 video/photo browser checks** covering picker, multi-select, drag/drop, mixed invalid files, TUS/ordinary upload queues and independent failures. |
| File Manager UI | **6 browser checks** at 1440/768/390 px: batches continue after failure, cards refresh, and lost metadata responses do not delete committed uploads. |
| Static/build checks | TypeScript no-emit, production Vite build and `git diff --check` pass. Existing bundle-size warnings remain. |

Tests also verify that non-admins cannot approve accounts, elevate roles, publish
jobs, access another account's statistics or obtain private/shared content after
revocation. Anonymous thumbnail/background/statistics requests do not increment
view counters. Existing reaction add/change/toggle-remove behavior is preserved.

## 5. Production inventory and preserved findings

Before deployment: **4 users, 5 videos, 4 photos, 31 Storage objects, 6 file metadata
rows, no Office preview jobs and 2 completed media upload jobs**. No active video
conversion was running at the deployment check.

The read-only checks found:

- **0** foreign-key violations, duplicate normalized Auth emails, missing
  profiles, profile/Auth email mismatches or password/activation contradictions.
- **0** negative analytics counters, event/counter discrepancies or missing
  video/photo analytics records.
- **0** missing catalog-backed physical payloads or physical size mismatches.
- **1** unreferenced catalog object and **1** unmatched physical payload of
  **50,331,648 bytes (48 MiB)**. These remain untouched. The latter has an old
  upload receipt indicating an interrupted upload.
- **15** TUS JSON receipts, classified separately from media files.
- **3** legacy Ready videos intentionally using the original-file fallback.
  Actual FFprobe checks confirmed all three are playable MP4/H.264/AAC,
  1920×1080. They were not renamed, deleted or reconverted.

## 6. Backup and read-only administration

The pre-change custom-format database backup was verified with `pg_restore --list`:

`/srv/streamly/audits/20261003/pre-audit-20261003T200035Z.dump`

SHA-256:
`6f11627820e5a391438c2d96fa846e1fdf76aec60388a9724c43e59da3ecb895d`

A second verified backup was taken immediately before deployment:

`/srv/streamly/audits/20261003/pre-deployment-20261004T010111Z.dump`

SHA-256:
`0328bcc377d0d74c48dec43bf6fa87caf7c03a74f74d41c85f3911270fbe0c96`

Backups, source rollback archive, schema inventory, deployment receipt and test
logs remain in the private server audit directory. Database backups contain
sensitive account data and must not be served publicly.

A further verified backup, `pre-auth-followup-20261004T011035Z.dump`, was taken
before applying the real-Auth role-initialization correction.

Restore procedure: stop application/worker writers and hold the deployment lock;
preserve current environment, roles and physical storage; validate the archive;
restore first into a separate empty database with the appropriate Supabase roles
using `pg_restore --exit-on-error --single-transaction`; inspect restored counts,
constraints and storage references. Only perform an explicitly planned production
restore after validating that target. Restore matching application code and
physical storage if those have changed. These database dumps are **not** backups
of uploaded physical files. No production restore was performed.

An administrator with server access can run the read-only checker:

```sh
python3 scripts/check-database-integrity.py \
  --container supabase-db \
  --storage-base /srv/streamly/supabase/volumes/storage/stub/stub \
  --output /srv/streamly/audits/integrity-report.json
```

Use the configured bucket/tenant directory if storage configuration changes.
The utility does not repair data and rejects a report location inside the scanned
storage directory. Reports contain private paths/IDs and are saved with mode
0600. No unauthenticated integrity endpoint was added.

## 7. Remaining limits

- Database transactions cannot atomically encompass separate filesystem/Storage
  HTTP operations. New publication fences, reconciliation and cleanup reduce
  failure windows; physical auditing remains necessary.
- Multi-object folder moves are still multiple Storage calls. Interrupted moves
  can be partially complete; the UI refreshes actual state and reports errors.
  This audit does not claim a whole-folder ACID transaction.
- Password tests exercise real SQL, real GoTrue HTTP and mocked edge handlers.
  The complete browser-to-Edge-to-Auth chain was not run as one live registration
  using a production account. The individual layers were tested separately.
- The live VM was not deliberately rebooted, its disk was not filled, and no
  production database crash was induced. Those faults were tested in isolation.
- Compound administrator email and optional-name edits still span Auth and
  profile calls; the login-email identity is synchronized atomically, but all
  optional field edits are not one distributed transaction.
- Existing unmatched storage needs a separately reviewed repair decision.
  Existing account deletion intentionally leaves uploaded storage; the checker
  detects leftovers rather than changing that policy.
- Physical scanning and the database snapshot cannot be one atomic snapshot
  while real uploads are occurring. Recheck transient discrepancies after the
  relevant upload/job finishes. Expensive filesystem scans are an explicit
  administrator operation, not performed on every Statistics request.

## 8. Deployment verification

The fixes were deployed to the active GitHub runner checkout, matching baseline
`89fbb237d45ea9145081649485ab8a9c10ada257`; the old `/opt/streamly/app` checkout
was not used. The deployment lock was held, verified backups were taken, and the
existing production configuration was retained.

- All four new migrations applied successfully; existing migration entries were
  skipped. No production accounts or content were created/deleted for testing.
- The live HTTPS website returned **200** and serves the rebuilt frontend.
- Database, web, Edge functions, media/preview workers and analytics collector
  were healthy. Both rebuilt worker images passed their fault tests.
- Deployed workers and the Admin Edge function were checked against reviewed
  source hashes. The schema comparison uses a fixed search path so role-specific
  type/function qualification cannot produce false differences.
- Final live foreign-key, identity, activation and analytics checks returned no
  inconsistencies. User/content/catalog counts and the preserved storage findings
  match the pre-deployment inventory.

Changes are present locally and deployed, but **not committed or pushed**. A later
Git deployment must include these files and new migrations; otherwise it can
replace the live source with the previous version. Private server deployment
receipts record file hashes and backups for recovery.
