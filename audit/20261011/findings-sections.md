### A01 — Initial account activation

**Severity:** HIGH  
**Category:** security issue  
**Confidence/scope:** Confirmed in isolated actual SQL and Edge handler

An unauthenticated caller knowing an approved regular account’s email can obtain its initial-password capability without proving possession of that mailbox.

- **Evidence:** auth-boundaries.json: the actual start_initial_login function and account-login handler issued a setup capability for a synthetic approved account with an empty initial password. No production account was targeted.
- **Reproduction:** In an isolated fixture, approve a regular account awaiting its first password; submit action=login with its email and an empty password. The setup-capable response is returned without an invitation or email verification challenge.
- **User/security/data impact:** A person who knows the email can activate the account first and impersonate the approved user. This branch is limited to eligible initial regular accounts; it does not demonstrate takeover of established password accounts or current administrators.
- **Root cause:** Approval marks the account eligible/confirmed, and the public endpoint treats knowledge of the email as sufficient identity proof. Strong capability entropy does not correct an unauthorized issuer.
- **Files/modules:** [supabase/functions/account-login/index.ts:49](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/account-login/index.ts:49>), [supabase/migrations/20260927120000_email_only_login.sql:47](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/migrations/20260927120000_email_only_login.sql:47>)
- **Recommended fix:** Require a single-use invitation or email OTP proving mailbox possession before issuing/claiming the first-password capability. Preserve email as username, optional names and administrator approval.
- **Risk of fixing:** Medium: changes activation and existing pending invitations. Plan a compatible transition without locking out approved users.
- **Regression tests:** Mailbox proof required; wrong/expired/reused tokens rejected; simultaneous claims single-use; disabled/rejected accounts denied; established accounts unchanged.

### A02 — Disabled-account authorization

**Severity:** HIGH  
**Category:** security issue  
**Confidence/scope:** Confirmed SQL/RLS gap; production JWT revocation interval unverified

Some authorization predicates accept a disabled or banned account with an existing authenticated actor claim.

- **Evidence:** auth-boundaries.json: actual is_admin() returned true for a synthetic disabled/banned administrator; the actual photo ownership SELECT policy returned a private row for a disabled regular owner.
- **Reproduction:** In the fixture, retain the actor claim, disable/ban its account and query the policy/helper. Do not disable a real production account merely to reproduce this.
- **User/security/data impact:** Disabling an account may not promptly end access through all REST/RLS paths. Admin role-based paths can remain privileged while an old access token remains valid. The duration on this deployment was not measured.
- **Root cause:** Legacy is_admin() and some owner policies check identity/role without a consistent active-account predicate. Token issuance checks and Messenger’s active-account checks do not automatically harden every existing policy.
- **Files/modules:** [supabase/migrations/20260824213348_add_admin_profiles_and_storage_config.sql:106](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/migrations/20260824213348_add_admin_profiles_and_storage_config.sql:106>), [supabase/migrations/20260901210225_configure_image_storage.sql:84](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/migrations/20260901210225_configure_image_storage.sql:84>)
- **Recommended fix:** Use a common server-side active-account predicate in restrictive RLS and privileged RPC/Edge entry points. Define access-token/session revocation behavior and audit every policy against it.
- **Risk of fixing:** Medium/high: broad policy changes can accidentally deny legitimate public/owner/admin access; stage and test before rollout.
- **Regression tests:** Pre-existing JWT claims after disable/ban/delete; normal owner/admin access; anonymous/public paths; background jobs; refreshed/revoked sessions.

### A03 — Frontend deployment and lazy loading

**Severity:** HIGH  
**Category:** confirmed bug  
**Confidence/scope:** Confirmed live

An open tab referencing a removed lazy JavaScript chunk crashes the entire application. The missing asset is served as HTML with a one-year immutable cache policy.

- **Evidence:** Opening Admin Statistics in a previously open production tab displayed the global Something went wrong screen and Failed to fetch dynamically imported module for /video/assets/AdminStatistics-fHZ8HZ1o.js. A read-only HTTP check returned 200, text/html; charset=utf-8 and public, max-age=31536000, immutable. Reload recovered; fresh Statistics loaded.
- **Reproduction:** Keep a tab open through deployment, then open a previously unused lazy page whose old chunk is no longer retained. The stale production tab reproduced this naturally; no deployment was triggered during the audit.
- **User/security/data impact:** Whole-app outage for that tab; drafts and active call providers may be unmounted. Interruption of a live call is an inference from the boundary placement, not a measured result.
- **Root cause:** Generic SPA fallback rewrites missing asset requests to index.html, while the asset matcher assigns immutable caching. A top-level ErrorBoundary owns the entire application.
- **Files/modules:** [docker/Caddyfile:14](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/docker/Caddyfile:14>), [src/main.tsx](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/main.tsx>), [src/components/ErrorBoundary.tsx](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/components/ErrorBoundary.tsx>)
- **Recommended fix:** Return real 404/no immutable error caching for missing assets, revalidate entry HTML, retain versioned chunks for a release window, and add bounded lazy-load recovery/local boundaries that protect active work.
- **Risk of fixing:** Medium: coordinate proxy caching and deployment asset retention; avoid reload loops or forced loss of drafts.
- **Regression tests:** Old tab across release; removed chunk; offline chunk failure; warm caches; active call/draft; fresh reload; static assets never receive SPA HTML.

### A04 — Storage-location configuration

**Severity:** HIGH  
**Category:** configuration issue  
**Confidence/scope:** Confirmed code/UI mismatch; production relocation not performed

The Admin Console describes filesystem mount paths and claims only new uploads are affected, but the implementation treats these settings as mutable Storage object-key prefixes used to resolve existing content.

- **Evidence:** AdminPage promises physical folders and existence/writability validation. storage-settings performs only string checks and saves database values. The media worker uses the setting as an object prefix; serve-media and image resolution prepend the current global value to existing relative record paths.
- **Reproduction:** On an isolated populated bucket, change videos_base_path/images_base_path and resolve a previously saved record. Its requested object key changes even though its bytes were not moved. Never change production paths simply for this test.
- **User/security/data impact:** A normal administrator configuration change can make existing media inaccessible and make cleanup/accounting reference the wrong keys. No production outage or byte loss from this setting was induced or proved.
- **Root cause:** Host filesystem placement, bucket key prefixes and record identity are conflated. The original storage location is not immutably recorded per content object.
- **Files/modules:** [src/components/AdminPage.tsx:683](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/components/AdminPage.tsx:683>), [supabase/functions/storage-settings/index.ts:26](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/storage-settings/index.ts:26>), [services/media-worker/worker.py:174](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/services/media-worker/worker.py:174>), [supabase/functions/serve-media/index.ts:105](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/serve-media/index.ts:105>), [src/lib/storageSettings.ts:89](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/storageSettings.ts:89>)
- **Recommended fix:** Separate actual host mount configuration from object prefixes. Store canonical per-object locations or a storage generation. If relocation is supported, implement an explicit validated migration and accurate UI rather than silently changing readers.
- **Risk of fixing:** High: existing data location and cleanup behavior are involved. Inventory and backups are prerequisites to any relocation.
- **Regression tests:** Old/new uploads across prefix changes; blank root; invalid/nonexistent host folder; failed migration rollback; playback/thumbnails/delete/statistics consistency.

### A05 — Administrator account deletion

**Severity:** HIGH  
**Category:** potential risk  
**Confidence/scope:** Confirmed handler race with mocked Auth; actual production concurrency untested

Two administrators can pass authorization before concurrently deleting each other; the handler has no durable last-administrator deletion guard.

- **Evidence:** admin-deletion-race.json: the real DELETE branch with a mocked Auth backend returned 200 twice and left zero administrators. Repository review found a locked last-admin role-change guard but no equivalent account DELETE guard. No real account was deleted.
- **Reproduction:** In a disposable environment with two administrators, synchronize each DELETE after its actor role check and before Auth deletion. Confirm the real database/Auth cascades in staging before asserting a production exploit.
- **User/security/data impact:** Potential total administrative lockout and difficult recovery. Client confirmations and the self-deletion check do not serialize cross-account deletion.
- **Root cause:** Authorization and deletion are separate steps; self deletion alone does not preserve at least one administrator during concurrent requests.
- **Files/modules:** [supabase/functions/admin-users/index.ts:112](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/admin-users/index.ts:112>), [supabase/migrations/20261003120000_account_integrity.sql](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/migrations/20261003120000_account_integrity.sql>)
- **Recommended fix:** Enforce the last-active-administrator invariant transactionally in the database/Auth deletion path and revalidate the actor at the mutation boundary. Cover deletion as well as demotion.
- **Risk of fixing:** Medium/high: integrate with Auth cascades without making legitimate account cleanup impossible.
- **Regression tests:** Two admins delete each other; delete versus demote/disable; last admin blocked; ordinary-user deletion; actor disabled after authorization; failed Auth deletion.

### A06 — Backup and recovery readiness

**Severity:** HIGH  
**Category:** potential risk  
**Confidence/scope:** Repository recovery coverage incomplete; actual server/offsite backups unverified

The documented recovery path backs up PostgreSQL before deployments, but does not establish scheduled independent media backups, off-host copies or tested full application recovery.

- **Evidence:** backup-database.sh creates same-host pg_dumpall archives, verifies gzip and retains them. DEPLOYMENT.md explicitly says media files are not copied and media backup will be configured. No server backup inventory or restoration evidence was accessible.
- **Reproduction:** Compare documented backup scope with database, Storage bytes, configuration/secrets, preview-derived data and VM recovery requirements. Inventory actual backup jobs read-only when host access becomes available.
- **User/security/data impact:** A database archive alone cannot restore uploaded content after storage/VM loss. Same-host copies are vulnerable to host loss. This is a readiness gap in supplied evidence, not proof that the operator has no separate backups.
- **Root cause:** Deployment safety backups are used as the documented recovery mechanism; a complete independent recovery plan is not demonstrated.
- **Files/modules:** [scripts/backup-database.sh](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/scripts/backup-database.sh>), [scripts/automated-deploy.sh](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/scripts/automated-deploy.sh>), [DEPLOYMENT.md:85](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/DEPLOYMENT.md:85>)
- **Recommended fix:** Verify actual schedules and off-host storage; establish encrypted database plus original-content/config backups, retention and alerts, and rehearse restore only on a separate environment. Document RPO/RTO.
- **Risk of fixing:** Low/medium to add backups; restore verification requires an isolated target and must never overwrite production.
- **Regression tests:** Recover database plus uploaded bytes and configuration on a separate host; verify counts/checksums and permissions; expired/revoked shares stay invalid; demonstrate a lost-host scenario.

### A07 — Video URL revocation

**Severity:** MEDIUM  
**Category:** potential risk  
**Confidence/scope:** Confirmed capability TTL; end-to-end revocation test deferred

Normal video playback uses a bearer Storage URL valid for one hour. A URL already issued can outlive a later application visibility/session change while the object still exists.

- **Evidence:** serve-media checks public/owner access when issuing createSignedUrl(...,3600). Subsequent Storage requests use that URL without re-running the application visibility decision. Temporary share streaming follows a different, per-request authorization path.
- **Reproduction:** In staging, issue a normal playback URL, make the video private or revoke the user session, and retry the existing URL before expiry. Do not change live content visibility during the audit.
- **User/security/data impact:** Potential privacy revocation delay for people holding an earlier URL. Object deletion may revoke access by removing bytes; this finding does not claim deleted bytes remain downloadable.
- **Root cause:** Authorization is captured in a long-lived URL capability instead of being checked for each normal playback request.
- **Files/modules:** [supabase/functions/serve-media/index.ts:116](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/serve-media/index.ts:116>)
- **Recommended fix:** Choose and document a revocation SLA. Where immediate revocation is required, reauthorize/proxy range requests or use revocable capabilities; otherwise shorten TTL and refresh safely during playback.
- **Risk of fixing:** Medium: affects seeking, caching and long video playback. Avoid making slow connections repeatedly fail.
- **Regression tests:** Public-to-private, account disable/logout, active seeking, expiry/refresh, deleted object; temporary shares keep their separate strict expiration behavior.

### A08 — Folder Move/Copy durability

**Severity:** MEDIUM  
**Category:** potential risk  
**Confidence/scope:** Confirmed client-side operation structure; browser-crash recovery not reproduced live

Multi-object transfers retain their immutable plan and completed-step sets only in client memory. Closing/reloading the browser after a partial transfer loses its recovery receipt.

- **Evidence:** executeFileOperation loops over Storage mutations then folder metadata updates, tracking done/metadataDone in Sets. Same-session retries pass local tests. Storage catalog triggers synchronize individual file metadata, but not the entire folder-tree transaction.
- **Reproduction:** In an isolated fixture, stop the browser after several objects commit but before the complete tree/folder metadata succeeds, then reopen and inspect both roots and shares.
- **User/security/data impact:** Potential partial trees, stale folder metadata/shares and ambiguous retry/conflict handling after browser loss. A successful ordinary transfer is not shown to corrupt data.
- **Root cause:** The transfer is a series of independent storage transactions without a durable server-side operation/job receipt spanning all steps.
- **Files/modules:** [src/lib/fileOperations.ts:18](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/fileOperations.ts:18>), [src/components/FileManager.tsx](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/components/FileManager.tsx>)
- **Recommended fix:** Add durable operation identity, planned object versions, per-step receipts and resumable server-side completion/reconciliation. Preserve non-overwrite conflict handling and confirmed replacement.
- **Risk of fixing:** Medium/high: filesystem/catalog/share identity changes require careful compatibility with current Storage policies.
- **Regression tests:** Reload/crash/uncertain response after each step; concurrent rename/delete/copy; retry does not overwrite; complete tree and sharing metadata reconcile; cancel exposes partial completion accurately.

### A09 — Large folder downloads

**Severity:** MEDIUM  
**Category:** performance issue  
**Confidence/scope:** Confirmed buffering design; memory exhaustion not stress-tested

Folder ZIP downloads accumulate payload Blobs in the browser and have ZIP32 format limits, but no practical lower aggregate memory budget or streaming archive path.

- **Evidence:** folderDownloads keeps every payload in parts; publicFiles downloads each complete response as a Blob. It rejects approximately 4 GiB/65,535 ZIP32 limits, which are far above practical memory on many phones.
- **Reproduction:** Use bounded local synthetic fixtures to measure memory as total archive size increases. No large production download/load test was performed.
- **User/security/data impact:** Potential tab termination, frozen UI or failed mobile downloads for large folders. No existing content is altered.
- **Root cause:** Client-side archive assembly is memory-backed for the full folder, despite incremental checksum reading.
- **Files/modules:** [src/lib/folderDownloads.ts:11](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/folderDownloads.ts:11>), [src/lib/publicFiles.ts:16](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/publicFiles.ts:16>)
- **Recommended fix:** Use a bounded streaming download/archive service or supported writable stream, with server-side permission checks, cancellation and clear size guidance. Add a conservative client guard when streaming is unavailable.
- **Risk of fixing:** Medium: new streaming infrastructure must preserve authorized paths and avoid leaking content through archive generation.
- **Regression tests:** Nested/empty/Unicode entries; bounded-memory large fixture; cancel/failure cleanup; permission revocation; ZIP integrity; small phone fallback.

### A10 — HTTP security headers

**Severity:** MEDIUM  
**Category:** security issue  
**Confidence/scope:** Confirmed live configuration gap; no XSS exploit demonstrated

The application response lacks Content-Security-Policy, Strict-Transport-Security and Permissions-Policy. The legacy root also lacks the observed application’s nosniff/frame/referrer protections.

- **Evidence:** public-health.json captures these missing headers. /video/ includes nosniff, SAMEORIGIN and strict-origin-when-cross-origin. Public origin identifies an IIS front door; Caddy is the repository upstream configuration.
- **Reproduction:** Inspect response headers for / and /video/ using a single ordinary GET. Repeat after any future proxy changes.
- **User/security/data impact:** Reduced defense in depth against script injection and downgrade/permission misuse. Missing CSP is not evidence of a working XSS vulnerability.
- **Root cause:** Hardening is incomplete and differs between the legacy root/front door and the application upstream.
- **Files/modules:** [docker/Caddyfile:24](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/docker/Caddyfile:24>), IIS/front-door configuration (not supplied)
- **Recommended fix:** Deploy a tested CSP starting in report-only mode; coordinate HSTS across the public HTTPS origin and certificate coverage; define camera/microphone/fullscreen/speaker permissions compatible with calls. Apply suitable root protections.
- **Risk of fixing:** Medium: an overly strict policy can break Supabase, PDF workers, media, previews and calls; do not disable working networking.
- **Regression tests:** Login, WebSocket, media/range requests, PDF worker, temporary shares, previews and voice/video/fullscreen; verify all public proxy layers.

### A11 — Public registration abuse protection

**Severity:** MEDIUM  
**Category:** potential risk  
**Confidence/scope:** Confirmed absence in application handler; gateway throttling unverified

The public registration handler does not enforce an application-wide per-source submission budget or a small body limit before parsing JSON.

- **Evidence:** notify-admin-registration accepts distinct valid emails and persists/notifies each; duplicate-email checks and email ledger idempotency work. Repository handler has no IP/global limiter. Production gateway/WAF body and request limits could not be inspected.
- **Reproduction:** Review the handler and gateway rules; exercise small bounded limiter tests locally. Do not send many live registrations or emails.
- **User/security/data impact:** Potential pending-request database growth, administrator email spam and provider spend under automated abuse. Existing same-email retries are protected.
- **Root cause:** Uniqueness/idempotency handles duplicate requests but does not bound requests using many different addresses.
- **Files/modules:** [supabase/functions/notify-admin-registration/index.ts:25](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/notify-admin-registration/index.ts:25>)
- **Recommended fix:** Enforce reasonable request-body bounds and layered per-source/global quotas at a trusted gateway or backend. Provide clear retry errors without blocking ordinary registrations.
- **Risk of fixing:** Low/medium: shared networks and proxy address trust need careful treatment; do not collect unnecessary personal telemetry.
- **Regression tests:** Distinct-email quota; trusted/untrusted forwarded addresses; oversized JSON; normal signup; duplicate retries; provider failure; quota reset.

### A12 — Registration email recovery

**Severity:** MEDIUM  
**Category:** potential risk  
**Confidence/scope:** Confirmed repository workflow gap; production scheduler/provider state unverified

Email failures are recorded and retryable, but the repository does not demonstrate a recurring dispatcher that eventually retries every failed/pending delivery without another user/admin action.

- **Evidence:** _shared/email.ts has persistent delivery claims, safe provider idempotency and bounded immediate retries. Registration/approval invokes delivery; no recurring email worker/timer was found in supplied deployment code. Provider behavior was tested with mocks only.
- **Reproduction:** In staging, fail a provider delivery, stop retrying the user request and observe whether a scheduled process retries the ledger. Inspect actual host schedules read-only.
- **User/security/data impact:** Potential permanently missed signup/admin/approval notification after a temporary mail outage, although the registration remains safely saved.
- **Root cause:** A durable delivery ledger exists, but autonomous replay of that ledger is not established.
- **Files/modules:** [supabase/functions/_shared/email.ts:59](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/_shared/email.ts:59>), [supabase/functions/notify-admin-registration/index.ts](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/notify-admin-registration/index.ts>), [supabase/functions/approve-registration/index.ts](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/approve-registration/index.ts>)
- **Recommended fix:** Verify external retry infrastructure; otherwise add a bounded, idempotent ledger dispatcher with lease expiry, backoff, dead-letter visibility and alerts.
- **Risk of fixing:** Low/medium: provider idempotency and delivery claims must remain authoritative to prevent duplicate mail.
- **Regression tests:** Timeout after provider accepted; persistent 429/5xx; process restart; expired claim; duplicate approval; exactly one receipt/admin notification per delivery key.

### A13 — Storage setting cache

**Severity:** MEDIUM  
**Category:** probable bug  
**Confidence/scope:** Confirmed code behavior; live setting changes deliberately not made

Module-level storage-prefix caches never expire or invalidate after saves and cache transient read failures as an empty prefix.

- **Evidence:** storageSettings.ts returns cached values indefinitely. saveSettingsPatch does not clear them. A failing first RPC assigns an empty string, so later reads never retry until reload.
- **Reproduction:** In a fixture, fail the first prefix RPC then recover; or resolve a prefix, save a different setting and resolve again in the same tab.
- **User/security/data impact:** Broken or stale image/path resolution after transient errors or changes, with inconsistent behavior across tabs. No production config was changed.
- **Root cause:** Configuration success and failure are cached permanently without versioning or invalidation.
- **Files/modules:** [src/lib/storageSettings.ts:76](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/storageSettings.ts:76>)
- **Recommended fix:** Do not cache errors as successful root configuration. Invalidate or version successful cached settings on save/account lifecycle and provide bounded retry/TTL. Coordinate with A04 canonical locations.
- **Risk of fixing:** Low/medium: avoid excessive settings RPCs and preserve valid empty-root semantics.
- **Regression tests:** Transient failure recovery; successful empty prefix; save invalidation; multiple tabs; unchanged locations; image preview/playback after reload.

### A14 — Dependency maintenance

**Severity:** MEDIUM  
**Category:** technical debt  
**Confidence/scope:** Confirmed registry advisory matches; production exploitability not established

The lockfile audit reports affected dependencies requiring triage and controlled upgrades.

- **Evidence:** npm-audit.json: 33 package findings, 25 high/6 moderate/2 low/0 critical. Direct affected development dependencies include Vite 5.4.8, PostCSS 8.4.47, Tailwind 3.4.17 and typescript-eslint 8.8.1. The only non-dev affected lock node is transitive ws 8.18.3.
- **Reproduction:** Re-run a lockfile registry audit and map each advisory to actual deployment paths rather than treating package severity as a verified application exploit.
- **User/security/data impact:** Development/build exposure and possible Node transport risk. Production frontend is served by the reverse proxy, not an exposed Vite dev server; browsers use native WebSocket. Actual Edge resolved packages/exposure remain unverified.
- **Root cause:** Pinned dependencies have not been advanced to fixes for currently listed advisories.
- **Files/modules:** [package.json](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/package.json>), [package-lock.json](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/package-lock.json>)
- **Recommended fix:** Patch/upgrade with advisory-by-advisory exposure review and required browser/build tests. Audit Edge/runtime images and actual resolved versions separately. Do not blindly apply major npm audit fixes.
- **Risk of fixing:** Medium: Vite/PDF/browser tooling and CSS upgrades can change output or preview behavior.
- **Regression tests:** Build/typecheck/lint; call/session/directory/deletion suites; PDF/Office previews; storage/shares; inspect runtime versions and verify advisories are resolved.

### A15 — CI regression gates

**Severity:** MEDIUM  
**Category:** technical debt  
**Confidence/scope:** Confirmed workflow configuration

CI allows lint failures and does not gate production deployment on the substantial Messenger, session, sharing, File Manager and preview regression suites.

- **Evidence:** .github/workflows/ci.yml marks lint continue-on-error:true. Gates include typecheck/build/Docker/Compose and media worker checks, but not the newer frontend/database fixture suites run by this audit.
- **Reproduction:** Inspect workflow jobs and compare their commands with available tests and recent product changes.
- **User/security/data impact:** A build can pass while important authorization/deletion/call/session workflows regress. Local passing tests do not protect future automated releases unless included in CI.
- **Root cause:** The CI test matrix has not kept pace with newer feature and permission coverage.
- **Files/modules:** [.github/workflows/ci.yml:33](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/.github/workflows/ci.yml:33>)
- **Recommended fix:** Make appropriate lint failures blocking and add a bounded, reproducible fixture matrix for security and high-impact workflows. Repair stale fixtures without weakening assertions.
- **Risk of fixing:** Low/medium: CI duration/flakiness and runtime packaging need deliberate management.
- **Regression tests:** A known broken permission/deletion/session fixture must fail CI; clean checkout dependencies; deterministic browser/SQL tests; publish sanitized failure artifacts.

### A16 — Backup filesystem confidentiality

**Severity:** MEDIUM  
**Category:** potential risk  
**Confidence/scope:** Confirmed script omission; live permissions unverified

The backup script does not explicitly restrict dump/directory permissions, so sensitive database backups depend on the caller’s inherited umask and existing directory ACLs.

- **Evidence:** backup-database.sh uses mkdir and shell redirection without umask 077 or explicit restrictive file/directory permissions. Actual /srv/streamly/backups permissions were not available.
- **Reproduction:** Run a harmless synthetic output under a permissive umask in staging, or inspect production backup permissions read-only; never print dump contents.
- **User/security/data impact:** Potential local disclosure of database contents/password hashes to unintended host users or services if inherited permissions are broad.
- **Root cause:** Sensitive-output permissions are implicit rather than enforced at creation.
- **Files/modules:** [scripts/backup-database.sh:22](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/scripts/backup-database.sh:22>)
- **Recommended fix:** Enforce restrictive umask/ownership and directory/file permissions, protect off-host copies, and validate backup access without displaying content.
- **Risk of fixing:** Low: ensure the authorized backup/restore operator still has access.
- **Regression tests:** Restrictive files under permissive parent/caller defaults; interrupted backup; rotation; authorized recovery; non-authorized host account cannot read.

### A17 — Integrity/reconciliation tooling coverage

**Severity:** MEDIUM  
**Category:** technical debt  
**Confidence/scope:** Confirmed source coverage gap; no production orphan count obtained

The supplied integrity checker predates Messenger and temporary sharing, so it cannot alone establish a complete current application integrity audit.

- **Evidence:** check-database-integrity.py explicitly inventories videos/photos/file metadata/media jobs/previews, but does not model Messenger attachment/message/reaction/call cleanup relationships or temporary-share lifecycle. Valid newer storage objects can lack modeled reference explanations.
- **Reproduction:** Compare the checker’s snapshot schema and reference accounting with the latest migrations and buckets. Run only extended read-only snapshots before considering cleanup.
- **User/security/data impact:** Potential false orphan classifications or missed current inconsistencies. Wasted-storage estimates and actual production DB/FS reconciliation are unverified, not zero.
- **Root cause:** Inventory/reference rules were not extended alongside newer content types and cleanup queues.
- **Files/modules:** [scripts/check-database-integrity.py:31](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/scripts/check-database-integrity.py:31>), [supabase/migrations/20261008010000_messenger.sql](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/migrations/20261008010000_messenger.sql>), [supabase/migrations/20261007010000_content_context_actions.sql](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/migrations/20261007010000_content_context_actions.sql>)
- **Recommended fix:** Extend read-only reference accounting and relationship checks to all current schemas/buckets, include retention/job state, and distinguish historical tombstones from true orphans. Never delete directly from this report.
- **Risk of fixing:** Low to inspect; high if its output later drives cleanup, which requires independent verification.
- **Regression tests:** Known valid Messenger attachment; queued cleanup; deleted-message tombstone; temporary share deleted target; missing object; orphan fixture; concurrent upload snapshot caveats.

### A18 — Storage root setting validation

**Severity:** LOW  
**Category:** confirmed bug  
**Confidence/scope:** Confirmed endpoint/default mismatch

An empty storage prefix is a valid current default, but the storage-settings save validator rejects empty paths.

- **Evidence:** The endpoint returns empty defaults, while validatePath immediately returns Path cannot be empty. saveStorageSettings always submits both paths with the external URL.
- **Reproduction:** In a fixture with root defaults, save those settings or try to return a prefix to bucket root. Do not change the production settings.
- **User/security/data impact:** Saving unchanged default paths or an unrelated URL can fail; administrator cannot cleanly restore a root prefix. No direct security impact demonstrated.
- **Root cause:** The validator assumes mandatory host folders while the storage implementation permits an empty bucket prefix.
- **Files/modules:** [supabase/functions/storage-settings/index.ts:27](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/storage-settings/index.ts:27>), [src/lib/storageSettings.ts:42](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/storageSettings.ts:42>)
- **Recommended fix:** Resolve storage semantics with A04, then consistently accept documented root defaults or present an explicit validated root option.
- **Risk of fixing:** Low/medium: coordinate with data-location compatibility, not merely bypass path validation.
- **Regression tests:** Default save; root restoration; nonempty prefix; malicious traversal; URL-only patch; old/new content remains accessible.

### A19 — External File Storage URL setting

**Severity:** LOW  
**Category:** UX issue  
**Confidence/scope:** Confirmed source/UI mismatch

The Admin Console says its external server URL opens from the sidebar, but the sidebar always opens the internal File Manager.

- **Evidence:** AdminPage explanatory text promises a new tab. App.tsx File Storage calls navigate(files); fetchFileServerUrl has no application consumer found.
- **Reproduction:** Review the sidebar click and setting consumer. Existing live sidebar opened #/files; no external setting was changed.
- **User/security/data impact:** A saved administrator setting has no described user-visible effect; navigation expectations are misleading. Internal private File Manager and top public Files are correctly distinct.
- **Root cause:** The setting/help text survived replacement of the external navigation flow with the internal manager.
- **Files/modules:** [src/components/AdminPage.tsx:738](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/components/AdminPage.tsx:738>), [src/App.tsx:201](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/App.tsx:201>), [src/lib/storageSettings.ts:80](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/storageSettings.ts:80>)
- **Recommended fix:** Decide whether the external link remains a supported feature. Add an accurately labeled separate safe link, or remove/deprecate the stale setting/help without replacing the required private manager.
- **Risk of fixing:** Low: avoid confusing public Files with private manager or unintentionally sending auth credentials to an external site.
- **Regression tests:** Empty/configured URL; valid HTTPS policy; private/public navigation remains correct; external target receives no application tokens.

### A20 — Call input-device selection display

**Severity:** LOW  
**Category:** UX issue  
**Confidence/scope:** Confirmed code; actual selected-PC-microphone transmission not measured

Microphone and camera selectors always render an empty controlled value, so a successful selection returns to Select microphone/Select camera instead of displaying the active device.

- **Evidence:** CallPanel.tsx input selects have value=""; handlers call engine.microphone/camera but no selected-device UI state is bound. Track replacement passed engine fixtures; live voice audio worked both ways.
- **Reproduction:** During an isolated active call choose a device and inspect the select value after replacement.
- **User/security/data impact:** Users cannot tell which device is active, which complicates the reported PC microphone issue. This does not prove the microphone track fails to transmit.
- **Root cause:** The selector is implemented as a command trigger without an active-device state binding.
- **Files/modules:** [src/components/CallPanel.tsx:162](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/components/CallPanel.tsx:162>), [src/lib/callEngine.ts](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/callEngine.ts>)
- **Recommended fix:** Display the confirmed active track/device after successful replacement, preserve the prior device on failure, and show a clear selection error/status.
- **Risk of fixing:** Low: avoid falsely showing a selected device before getUserMedia/replaceTrack succeeds.
- **Regression tests:** Select/switch microphone during live audio; preserve mute; failure retains previous track; actual deviceId/settings match display; all senders replaced without new peers.

### A21 — Messenger text encoding

**Severity:** LOW  
**Category:** UX issue  
**Confidence/scope:** Confirmed live and source

Several Messenger labels contain literal mojibake such as Private conversations В· and Type a messageвЂ¦.

- **Evidence:** The production header and source literals reproduce the malformed separator/ellipsis. Valid non-English uploaded names are a separate supported behavior and are not this finding.
- **Reproduction:** Open Messenger and inspect header/loading/placeholder labels.
- **User/security/data impact:** Unpolished and sometimes confusing visible text; no security/data impact.
- **Root cause:** Double-encoded characters were saved in source strings.
- **Files/modules:** [src/components/Messenger.tsx:52](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/components/Messenger.tsx:52>), [src/components/Messenger.tsx:268](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/components/Messenger.tsx:268>)
- **Recommended fix:** Replace malformed literals with intended Unicode characters and verify UTF-8 handling/editor configuration.
- **Risk of fixing:** Low.
- **Regression tests:** Snapshot/accessibility labels for separators/loading/placeholders; non-English names remain intact.

### A22 — Regression fixture drift

**Severity:** LOW  
**Category:** technical debt  
**Confidence/scope:** Confirmed test failures; diagnostic-only adaptations isolated

Some regression fixtures no longer reflect current components, and one expiry fixture violates an exact database constraint through independent clock reads.

- **Evidence:** Original content-context-db uses two clock_timestamp() values, producing a microsecond difference and failing expires_at=created_at+24 hours; the audit copy uses transaction now() and all six checks pass. File preview tests still target removed .fm-menu button selectors; adapting only diagnostic copies to current menuitems passed 32 groups. Settings fixture crashes because SettingsPage now renders MessageBell but the harness lacks MessengerProvider.
- **Reproduction:** Run the original suites in isolated environments. The initial batch additionally had an audit runner API-origin mismatch; that was a diagnostic mistake, not an application finding, and corrected runs are retained separately.
- **User/security/data impact:** False alarms, skipped coverage or misleading green checks if assertions are weakened to compensate. Settings navigation is not established by its failing fixture.
- **Root cause:** Test clocks, context providers and UI semantics drifted as features changed.
- **Files/modules:** [tests/content-context-db.mjs:65](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/tests/content-context-db.mjs:65>), [tests/file-previews.mjs:55](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/tests/file-previews.mjs:55>), [tests/settings-navigation-harness.tsx](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/tests/settings-navigation-harness.tsx>)
- **Recommended fix:** Repair upstream fixtures with a single consistent timestamp, required providers and current semantic locators; preserve all behavioral assertions and make the suites CI gates.
- **Risk of fixing:** Low: review fixture changes carefully to avoid hiding a genuine regression.
- **Regression tests:** Original tests pass from a clean checkout; exact 24-hour constraint retained; preview failures remain caught; settings dirty navigation and draft guards genuinely exercised.

### A23 — Tracked generated frontend build

**Severity:** LOW  
**Category:** technical debt  
**Confidence/scope:** Confirmed repository artifact; deployment use not established

An older generated dist bundle is tracked alongside current source, creating release ambiguity and noisy credential-looking scan hits.

- **Evidence:** secret-scan.json identifies JWT literals in dist/assets/index-C1uVwNC-.js with role=anon. These are public application keys, not a verified leaked service secret. The supplied Docker build excludes dist and builds source freshly.
- **Reproduction:** Compare tracked dist assets with current build/deploy entry points without printing key values.
- **User/security/data impact:** Potential stale accidental hosting and confusing reviews/scans. No private service key leak was confirmed from these literals.
- **Root cause:** Generated output has remained in Git despite a source-build deployment flow.
- **Files/modules:** [dist/assets/index-C1uVwNC-.js](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/dist/assets/index-C1uVwNC-.js>), [.dockerignore](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/.dockerignore>), [Dockerfile](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/Dockerfile>)
- **Recommended fix:** Stop tracking stale build output after reviewing actual publishing dependencies; use versioned immutable deployment artifacts with a recorded source SHA.
- **Risk of fixing:** Low/medium: verify no legacy host relies on tracked dist before removal.
- **Regression tests:** Clean source build/deployment; expected asset release retained; public anon key classification; no service secrets embedded; legacy hosting checked.

### A24 — Administrator private-video playback consistency

**Severity:** LOW  
**Category:** probable bug  
**Confidence/scope:** Confirmed policy/handler mismatch; live cross-owner private playback untested

Administrator video catalog access and the playback authorization handler have different rules for another owner’s private video.

- **Evidence:** Video administrator SELECT access exists in policies/UI, whereas serve-media accepts only public videos or the matching owner when issuing a playback URL.
- **Reproduction:** In staging, list a different owner’s private video as administrator and attempt playback. Do not make a live private video public to work around it.
- **User/security/data impact:** Potential visible administrative card that cannot play. This is a denial inconsistency, not an unauthorized disclosure.
- **Root cause:** The service authorization does not implement the same intended administrator rule as catalog access.
- **Files/modules:** [supabase/functions/serve-media/index.ts:60](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/functions/serve-media/index.ts:60>), [supabase/migrations/20260825193539_add_videos_and_config.sql:127](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/supabase/migrations/20260825193539_add_videos_and_config.sql:127>)
- **Recommended fix:** Document intended administrative media access and align catalog, UI and serving permissions using the hardened active-admin predicate from A02.
- **Risk of fixing:** Medium if granting access: confirm product policy explicitly; never broaden ordinary-user access.
- **Regression tests:** Owner/public/active admin/disabled admin/outsider paths; private responses and signed URL issuance follow one documented policy.

### I01 — Physical mobile audio routing

**Severity:** INFORMATIONAL  
**Category:** platform/browser limitation  
**Confidence/scope:** Feature/policy tests passed; actual phone routes unverified

A website cannot promise speaker/earpiece switching on every browser or infer a physical route from a decorative button.

- **Evidence:** Current output code feature-detects sink/picker support and waits for confirmed routing; sixteen policy tests and ten UI scenarios passed, including unsupported iPhone/Android APIs and attached headset preservation. These are fixtures, not real hardware route measurements.
- **Reproduction:** Inspect available output APIs on each real device and verify physical audio by listening; do not infer it from screen width or a mock sink.
- **User/security/data impact:** Where APIs are absent, the OS/browser controls the route. A connected voice call can still work normally; it is inaccurate to claim universal forced earpiece/speaker support.
- **Root cause:** Browser/OS output selection permissions and enumerated physical devices vary.
- **Files/modules:** [src/lib/callAudioOutput.ts](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/callAudioOutput.ts>), [src/hooks/useCallAudioOutput.ts](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/hooks/useCallAudioOutput.ts>), [src/components/CallPanel.tsx](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/components/CallPanel.tsx>)
- **Recommended fix:** Retain honest confirmed-state UI and graceful fallback. Validate Android Chrome, iPhone Firefox/Safari and real Bluetooth/wired devices before claiming hardware compliance.
- **Risk of fixing:** Low if existing feature detection is preserved.
- **Regression tests:** Real outgoing/accepted voice/video defaults; actual sink success/failure; headset preservation; route changes keep the same RTCPeerConnection.

### I02 — Live video test environment

**Severity:** INFORMATIONAL  
**Category:** platform/browser limitation  
**Confidence/scope:** Confirmed permission failure; platform cause unresolved

The desktop in-app browser returned camera permission denied twice, including after the user reported enabling camera access. The user separately reports that desktop camera access works.

- **Evidence:** video-permission-denied.png and live-call-retest.json. A prior real voice call connected for 31 seconds and the user explicitly confirmed audio worked both ways. The repeated voice call reached Active call and refreshed history records completion at 29 seconds. Refreshed history also records a video call completed at 15 seconds, but the agent observed a capture-permission error rather than usable video; actual video media was not verified.
- **Reproduction:** Start Video call in the connected in-app browser; the agent sees a permission-denied notice. A completed signaling/history entry does not by itself establish transmitted/decoded camera video. Repeating the permission failure does not establish a TURN/signaling defect.
- **User/security/data impact:** Actual PC↔iPhone video, physical microphone switching, camera black/resume and live fullscreen remain unverified. The local video/track/layout suites passed separately.
- **Root cause:** Denied browser/host camera capture; the exact in-app/OS/device permission source was not determined. Do not attribute the user’s working desktop browser to this connected browser.
- **Files/modules:** [src/lib/callEngine.ts:12](<C:/Users/aleks/OneDrive/Desktop/Bolt/Project/src/lib/callEngine.ts:12>), Desktop in-app browser permission layer (outside repository)
- **Recommended fix:** Use an explicitly connected browser with working camera permission or conduct an operator-assisted hardware test and record exact versions/results. Do not change working TURN/router settings.
- **Risk of fixing:** Low for testing; avoid unnecessary persistent permission or network changes.
- **Regression tests:** Both directions on real devices; selected microphone deviceId/sender and audible transmission; camera off/on; fullscreen; headset/output routing; call cleanup.
