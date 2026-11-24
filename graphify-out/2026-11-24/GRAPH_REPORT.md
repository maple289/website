# Graph Report - Project  (2026-11-24)

## Corpus Check
- 484 files · ~373,729 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 64 file(s) not represented in the graph (top: .log 24, .css 20, (none) 11)

## Summary
- 2692 nodes · 6079 edges · 137 communities (100 shown, 37 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 90 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a65c8f85`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- supabase.ts
- AuthContext.tsx
- lucide-react
- Messenger.tsx
- CallEngine
- ref_node_fs
- react
- AdminPage.tsx
- ref_node_path
- CallPanel.tsx
- AdminStatistics.tsx
- TaskModal
- ref_node_assert
- media-receipt-cleanup
- time
- library-storage-links-http.mjs
- media-reactions-harness.tsx
- messenger-call-engine.mjs
- pathlib
- subprocess
- messenger-notifications-worker.mjs
- env
- build_user_guide_en.py
- analytics-collector
- media-double-tap.mjs
- PublicationTests
- uuid
- ref_npm_supabase
- diagnose-registration-email.py
- picomatch-security.mjs
- with
- useVideoPresentation.ts
- web
- push-dispatcher
- file-preview-worker/worker.py
- convert.py
- json
- email-dispatcher
- file-preview-worker
- sql
- unicode-file-names.mjs
- media-job-storage-locations.mjs
- audit-storage-layout.py
- validate.py
- compilerOptions
- scan.js
- appHistory.ts
- TemporaryShareModal.tsx
- Peer
- messenger-group-sharing-db.mjs
- retired-storage-cleanup.mjs
- steps
- messenger-notifications-db.mjs
- storage-location-compatibility.mjs
- compilerOptions
- messenger-calls.mjs
- environment
- devDependencies
- account-login/index.ts
- library-storage-links-db.mjs
- FakeSession
- package.json
- group-media-upload-db.mjs
- workspace_fixture
- temporary-share-server.mjs
- picomatch
- Peer
- settings-navigation-diagnostic.mjs
- time
- dependencies
- CollectorTests
- notify-admin-registration/index.ts
- email.ts
- Peer
- single-final-video-publication.mjs
- environment
- environment
- eslint.config.js
- ReactionStore
- messenger-media/index.ts
- content-context-db.mjs
- picomatch
- ref_node_crypto
- utils.js
- parse.js
- picomatch/package.json
- scripts
- uuid
- messenger-message-deletion.mjs
- messenger-people.mjs
- @electric-sql/pglite
- audit-client-resilience.mjs
- folder-uploads.mjs
- media-uploads.mjs
- PushTests
- parse
- test-file-sharing.mjs
- notification-core.js
- notifications-sw.js
- FileManager.tsx
- admin-statistics-reset-db.mjs
- main
- media-reactions.mjs
- build-report.mjs
- file-previews-diagnostic.mjs
- content-context-db-diagnostic.mjs
- deploy.sh
- library-storage-sign/index.ts
- temporary-share/index.ts
- file-previews.mjs
- CleanupPlanTests
- ReadinessTests
- CopyPlan
- messenger-calls/index.ts
- GatewayTemplate
- MigrationPreparation
- constants.js
- apply-migrations.sh
- backup-full.sh
- tsconfig.json
- mcp.json
- start-web.sh
- automated-deploy.sh
- backup-database.sh
- bootstrap-supabase.sh
- check-email-runtime.sh
- promote-first-admin.sh
- sync-functions.sh

## God Nodes (most connected - your core abstractions)
1. `react` - 103 edges
2. `useAuth()` - 61 edges
3. `supabase` - 56 edges
4. `FileManager()` - 49 edges
5. `lucide-react` - 47 edges
6. `TaskModal` - 39 edges
7. `useDeleteConfirmation()` - 38 edges
8. `CallEngine` - 37 edges
9. `useGuardedClose()` - 34 edges
10. `DeleteConfirmationProvider()` - 33 edges

## Surprising Connections (you probably didn't know these)
- `Window` --references--> `validateMediaFile()`  [EXTRACTED]
  tests/media-upload-harness.tsx → src/lib/mediaValidation.ts
- `Fixture()` --calls--> `CallPanel()`  [EXTRACTED]
  tests/messenger-notifications-harness.tsx → src/components/CallPanel.tsx
- `Harness()` --calls--> `DeleteConfirmationProvider()`  [EXTRACTED]
  tests/content-context-harness.tsx → src/components/DeleteConfirmationProvider.tsx
- `Harness()` --calls--> `DeleteConfirmationProvider()`  [EXTRACTED]
  tests/file-integrity-harness.tsx → src/components/DeleteConfirmationProvider.tsx
- `Harness()` --calls--> `DeleteConfirmationProvider()`  [EXTRACTED]
  tests/file-previews-harness.tsx → src/components/DeleteConfirmationProvider.tsx

## Import Cycles
- 2-file cycle: `src/lib/authSession.ts -> src/lib/notifications.ts -> src/lib/authSession.ts`

## Communities (137 total, 37 thin omitted)

### Community 0 - "supabase.ts"
Cohesion: 0.04
Nodes (77): react-dom, @supabase/supabase-js, CallPanel(), DeleteConfirmationProvider(), Pending, ReactionProvider(), Item, TemporarySharePage() (+69 more)

### Community 1 - "AuthContext.tsx"
Cohesion: 0.08
Nodes (54): NotificationSettings(), AuthProvider(), clearSavedPasswordSetup(), readableError(), empty, MessageCard(), NotificationContext, NotificationProvider() (+46 more)

### Community 2 - "lucide-react"
Cohesion: 0.09
Nodes (57): lucide-react, ContentAction, ContentContextMenu(), MenuAnchor, EditPhotoModal(), EditVideoModal(), EditVideoModalProps, FileDropArea() (+49 more)

### Community 3 - "Messenger.tsx"
Cohesion: 0.06
Nodes (73): FilePreview(), PdfFilePreview, State, ConversationPane(), currentConversation(), Draft, FilePreview, MessageItem() (+65 more)

### Community 4 - "CallEngine"
Cohesion: 0.08
Nodes (19): browser, Peer, ToneContext, CallEngine, CallState, emptyCallState, friendly(), Peer (+11 more)

### Community 5 - "ref_node_fs"
Cohesion: 0.03
Nodes (43): admins, barrier, createClient(), result, db, results, key, page (+35 more)

### Community 6 - "react"
Cohesion: 0.10
Nodes (34): react, App(), AppContent(), getRoute(), Messenger, NavItem(), Route, UserStatistics (+26 more)

### Community 7 - "AdminPage.tsx"
Cohesion: 0.08
Nodes (39): AddUserModal(), AdminStatistics, AuthHeadersFn, ChangeRoleModal(), EditUserModal(), PendingRegistration, PendingRegistrations(), Profile (+31 more)

### Community 8 - "ref_node_path"
Cohesion: 0.05
Nodes (31): playwright@^1.58.2, vite@^7.3.7, @vitejs/plugin-react@^4.7.0, playwright, vite, @vitejs/plugin-react, suites, completeFrame() (+23 more)

### Community 9 - "CallPanel.tsx"
Cohesion: 0.09
Nodes (25): ActiveCall(), Avatar(), corners, duration(), ExpiredNotificationCall(), Media(), RemoteVideo(), SelfView() (+17 more)

### Community 10 - "AdminStatistics.tsx"
Cohesion: 0.12
Nodes (43): activityColumns, AdminStatistics(), fileColumns, mediaColumns, OwnerFilter(), sections, StorageDetails(), SummaryCards() (+35 more)

### Community 11 - "TaskModal"
Cohesion: 0.12
Nodes (30): BatchUploadModal(), Item, FileShareModal(), Grant, message(), ShareUser, PhotoUploadModal(), PhotoUploadModalProps (+22 more)

### Community 12 - "ref_node_assert"
Cohesion: 0.04
Nodes (12): browser, browser, photoFile, videoFile, browser, browser, directoryCalls, large (+4 more)

### Community 13 - "media-receipt-cleanup"
Cohesion: 0.05
Nodes (43): context, GLOBAL_S3_BUCKET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, TENANT_ID, interval, retries, start_period (+35 more)

### Community 14 - "time"
Cohesion: 0.10
Nodes (15): deliver(), endpoint_allowed(), load_key(), main(), PushSession, rpc(), ttl_for(), cache_absent() (+7 more)

### Community 15 - "library-storage-links-http.mjs"
Cohesion: 0.15
Nodes (8): admin, options, outer, privateUrl, raw, resource, rows, source

### Community 16 - "media-reactions-harness.tsx"
Cohesion: 0.11
Nodes (24): Person, Props, ReactionBar(), ReactionControl(), ReactionDetails(), reactionViewport(), PhotoViewer(), PhotoViewerProps (+16 more)

### Community 17 - "messenger-call-engine.mjs"
Cohesion: 0.05
Nodes (20): accepting, browser, call, captured, connectionPeer, delayed, engine, exports (+12 more)

### Community 18 - "pathlib"
Cohesion: 0.09
Nodes (4): Response, DiagnosticsTests, Response, StorageAudit

### Community 19 - "subprocess"
Cohesion: 0.10
Nodes (17): identifier(), inspect_snapshot(), issue(), reference(), main(), query(), prepare(), main() (+9 more)

### Community 20 - "messenger-notifications-worker.mjs"
Cohesion: 0.07
Nodes (30): active, alreadyAnswered, anotherOwner, binding, call, close, context, conversation (+22 more)

### Community 21 - "env"
Cohesion: 0.06
Nodes (35): concurrency, cancel-in-progress, group, env, if, runs-on, steps, timeout-minutes (+27 more)

### Community 22 - "build_user_guide_en.py"
Cohesion: 0.09
Nodes (12): GuideCanvas, GuideDoc, inline(), screenshot(), shot_flow(), visual(), GuideCanvas, GuideDoc (+4 more)

### Community 23 - "analytics-collector"
Cohesion: 0.06
Nodes (33): build, cap_drop, cpus, environment, healthcheck, image, mem_limit, pids_limit (+25 more)

### Community 24 - "media-double-tap.mjs"
Cohesion: 0.22
Nodes (3): click(), openPhoto(), openVideo()

### Community 25 - "PublicationTests"
Cohesion: 0.10
Nodes (4): BitrateDecisions, PublicationTests, api(), validate()

### Community 26 - "uuid"
Cohesion: 0.24
Nodes (7): collect(), main(), rpc(), cpu_counters(), cpu_usage(), memory_usage(), monitor()

### Community 27 - "ref_npm_supabase"
Cohesion: 0.08
Nodes (9): corsHeaders, headers, headers, headers, headers, headers, headers, headers (+1 more)

### Community 29 - "picomatch-security.mjs"
Cohesion: 0.07
Nodes (23): results, suites, suites, config, conversionMount, overlays, result, run (+15 more)

### Community 30 - "with"
Cohesion: 0.07
Nodes (30): BROWSER_CHANNEL, BROWSER_ENGINE, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL, jobs, media-validation, validate, runs-on (+22 more)

### Community 31 - "useVideoPresentation.ts"
Cohesion: 0.15
Nodes (22): VideoPresentationControls(), usesNativeTouchPresentation(), useVideoCompletion(), useVideoControlsAutoHide(), capabilities(), empty, Snapshot, useVideoPresentation() (+14 more)

### Community 32 - "web"
Cohesion: 0.07
Nodes (27): VITE_BASE_PATH, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL, args, context, APP_ADDRESS, SUPABASE_API_UPSTREAM, interval (+19 more)

### Community 33 - "push-dispatcher"
Cohesion: 0.07
Nodes (27): context, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, VAPID_SUBJECT, interval, retries, start_period, test (+19 more)

### Community 34 - "file-preview-worker/worker.py"
Cohesion: 0.15
Nodes (14): request(), AmbiguousPublication, CacheLocations, response(), api(), cache_location(), cleanup(), current() (+6 more)

### Community 35 - "convert.py"
Cohesion: 0.19
Nodes (6): block_network(), convert(), validate_legacy_workbook(), validate_package(), package(), rejected()

### Community 36 - "json"
Cohesion: 0.20
Nodes (19): api(), CancelledUpload, check_cancelled(), cleanup_failed_uploads(), cleanup_finalized_video_sources(), cleanup_scratch(), download(), job_storage_location() (+11 more)

### Community 37 - "email-dispatcher"
Cohesion: 0.08
Nodes (24): cap_drop, command, cpus, environment, healthcheck, image, mem_limit, read_only (+16 more)

### Community 38 - "file-preview-worker"
Cohesion: 0.08
Nodes (23): context, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, build, cap_add, cap_drop, cpus, environment (+15 more)

### Community 39 - "sql"
Cohesion: 0.19
Nodes (9): IntegrityWorkflows, demote(), react(), view(), publish(), main(), object_row(), remove_object() (+1 more)

### Community 40 - "unicode-file-names.mjs"
Cohesion: 0.27
Nodes (7): db, decode(), key(), location(), other, owner, sql()

### Community 41 - "media-job-storage-locations.mjs"
Cohesion: 0.33
Nodes (6): actor(), db, queue(), reserve(), sql(), upload()

### Community 42 - "audit-storage-layout.py"
Cohesion: 0.18
Nodes (13): checksum(), identifier(), inspect_files(), key(), local_file(), main(), make_manifest(), add() (+5 more)

### Community 43 - "validate.py"
Cohesion: 0.19
Nodes (9): RealBitrateConversions, InvalidMedia, measured_bitrate(), mp4_faststart(), number(), photo(), probe(), run() (+1 more)

### Community 44 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleDetection (+11 more)

### Community 45 - "scan.js"
Cohesion: 0.11
Nodes (4): depth(), isPathSeparator(), scan(), removeBackslashes()

### Community 46 - "appHistory.ts"
Cohesion: 0.20
Nodes (16): FileView, Location, readLocation(), root, urlFor(), useFileNavigation(), useSettingsNavigation(), goBackAfterConfirmation() (+8 more)

### Community 47 - "TemporaryShareModal.tsx"
Cohesion: 0.31
Nodes (10): TemporaryShareModal(), appBasePath(), temporarySharePath(), temporaryShareRoute(), createTemporaryLink(), getTemporaryLink(), revokeTemporaryLink(), ShareTarget (+2 more)

### Community 48 - "Peer"
Cohesion: 0.12
Nodes (3): browser, Peer, ToneContext

### Community 49 - "messenger-group-sharing-db.mjs"
Cohesion: 0.15
Nodes (13): chat(), db, group(), member, outsider, owner, photo, readable() (+5 more)

### Community 50 - "retired-storage-cleanup.mjs"
Cohesion: 0.12
Nodes (8): db, hash, owner, paused(), remove(), run, sql(), results

### Community 51 - "steps"
Cohesion: 0.12
Nodes (15): runs-on, steps, timeout-minutes, jobs, health, name, on, workflow_dispatch (+7 more)

### Community 52 - "messenger-notifications-db.mjs"
Cohesion: 0.20
Nodes (14): a, actor(), admin(), b, call(), chat(), claim(), db (+6 more)

### Community 53 - "storage-location-compatibility.mjs"
Cohesion: 0.16
Nodes (12): db, group, member, outsider, owner, photo, publicImage(), resolve() (+4 more)

### Community 54 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+7 more)

### Community 55 - "messenger-calls.mjs"
Cohesion: 0.15
Nodes (11): a, b, chat(), db, fifth, fourth, outsider, rpc() (+3 more)

### Community 56 - "environment"
Cohesion: 0.14
Nodes (13): environment, GOTRUE_DISABLE_SIGNUP, GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED, GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI, GOTRUE_HOOK_SEND_EMAIL_ENABLED, GOTRUE_HOOK_SEND_EMAIL_URI, GOTRUE_MAILER_NOTIFICATIONS_PASSWORD_CHANGED_ENABLED, GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD (+5 more)

### Community 57 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, @electric-sql/pglite@^0.5.8, eslint@^9.39.5, postcss@^8.5.29, tailwindcss@^4.3.3, @tailwindcss/postcss@^4.3.3, @types/react@^18.3.5, typescript@^5.5.3 (+5 more)

### Community 58 - "account-login/index.ts"
Cohesion: 0.21
Nodes (6): hash(), headers, hex(), InputError, readSmallJson(), corsHeaders

### Community 59 - "library-storage-links-db.mjs"
Cohesion: 0.28
Nodes (8): check(), db, otherSid, owner, resolve(), sid, sql(), viewer

### Community 61 - "package.json"
Cohesion: 0.15
Nodes (12): @types/react-dom@^18.3.0, @types/tus-js-client@^1.8.0, name, overrides, picomatch, @typescript-eslint/typescript-estree, private, type (+4 more)

### Community 62 - "group-media-upload-db.mjs"
Cohesion: 0.22
Nodes (10): calls, db, error(), family, prepare(), queue(), root(), service() (+2 more)

### Community 63 - "workspace_fixture"
Cohesion: 0.33
Nodes (3): AuditSafety, fixture(), workspace_fixture()

### Community 64 - "temporary-share-server.mjs"
Cohesion: 0.15
Nodes (7): created, link, storageCalls, stored, tableReads, token, tokens

### Community 65 - "picomatch"
Cohesion: 0.21
Nodes (4): picomatch(), isObject(), picomatch(), isWindows()

### Community 67 - "settings-navigation-diagnostic.mjs"
Cohesion: 0.06
Nodes (5): contexts, errors, contexts, errors, png

### Community 68 - "time"
Cohesion: 0.17
Nodes (15): auth_config(), backup(), directives(), main(), publish(), restart(), restore(), write() (+7 more)

### Community 69 - "dependencies"
Cohesion: 0.20
Nodes (9): dependencies, lucide-react@^0.446.0, pdfjs-dist@6.3.289, react@^18.3.1, react-dom@^18.3.1, @supabase/supabase-js@^2.57.4, pdfjs-dist, pdfjs-dist/legacy/web/pdf_viewer.mjs (+1 more)

### Community 70 - "CollectorTests"
Cohesion: 0.23
Nodes (3): CollectorTests, walk(), rpc()

### Community 71 - "notify-admin-registration/index.ts"
Cohesion: 0.26
Nodes (6): corsHeaders, corsHeaders, customerEmailsEnabled(), deliverEmail(), escapeHtml(), registrationTemplate()

### Community 72 - "email.ts"
Cohesion: 0.36
Nodes (10): configuredSender(), deliverEmailImpl(), EmailResult, safeEmailLog(), sendEmail(), appendTemporaryPassword(), approvalPassword(), encode() (+2 more)

### Community 74 - "single-final-video-publication.mjs"
Cohesion: 0.48
Nodes (5): db, prepare(), publish(), root(), sql()

### Community 75 - "environment"
Cohesion: 0.18
Nodes (10): SEED_SELF_HOST, STUN_URLS, TURN_SHARED_SECRET, TURN_URLS, environment, cpu_shares, environment, services (+2 more)

### Community 76 - "environment"
Cohesion: 0.18
Nodes (10): ADMIN_NOTIFICATION_RECIPIENTS, CUSTOMER_EMAILS_ENABLED, RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME, SITE_NAME, SITE_URL, environment (+2 more)

### Community 77 - "eslint.config.js"
Cohesion: 0.18
Nodes (10): @eslint/js@^9.39.5, eslint-plugin-react-hooks@^5.1.0-rc.0, eslint-plugin-react-refresh@^0.4.11, globals@^15.9.0, typescript-eslint@^8.71.1, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh (+2 more)

### Community 79 - "messenger-media/index.ts"
Cohesion: 0.25
Nodes (7): headers, json(), unavailable(), headers, json(), unavailable(), previewFormats

### Community 82 - "ref_node_crypto"
Cohesion: 0.08
Nodes (12): picked, client, credentials, env, logs, source, access, admin (+4 more)

### Community 84 - "parse.js"
Cohesion: 0.42
Nodes (10): analyzeRepeatedExtglob(), buildCharClassStar(), getStarExtglobSequenceChars(), hasRepeatedCharPrefixOverlap(), hasUnboundedRepeat(), isPlainBranch(), normalizeSimpleBranch(), parseRepeatedExtglob() (+2 more)

### Community 85 - "picomatch/package.json"
Cohesion: 0.18
Nodes (10): description, engines, node, files, license, main, name, private (+2 more)

### Community 86 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, lint, prebuild, predev, preview, test:core (+2 more)

### Community 87 - "uuid"
Cohesion: 0.18
Nodes (5): export_workbook(), property_value(), clean_receipts(), main(), ReceiptCleanupTests

### Community 88 - "messenger-message-deletion.mjs"
Cohesion: 0.22
Nodes (6): a, b, chat(), db, sql(), stranger

### Community 89 - "messenger-people.mjs"
Cohesion: 0.22
Nodes (6): a, b, chat(), db, outsider, sql()

### Community 90 - "@electric-sql/pglite"
Cohesion: 0.06
Nodes (28): @electric-sql/pglite, source, setupFileStorageFixture(), allowed, db, other, owner, createClient() (+20 more)

### Community 91 - "audit-client-resilience.mjs"
Cohesion: 0.22
Nodes (4): entry, folderModule, publicModule, settingsModule

### Community 92 - "folder-uploads.mjs"
Cohesion: 0.20
Nodes (9): attempted, drop(), entryFile(), exports, failures, file(), interrupted, picked (+1 more)

### Community 93 - "media-uploads.mjs"
Cohesion: 0.25
Nodes (7): check(), corrupt, errors, executable, goodPhoto, goodVideo, setup()

### Community 95 - "parse"
Cohesion: 0.31
Nodes (8): globChars(), expandRange(), parse(), syntaxError(), escapeLast(), escapeRegex(), hasRegexChars(), removePrefix()

### Community 96 - "test-file-sharing.mjs"
Cohesion: 0.39
Nodes (7): check(), db, denied(), login(), query(), readable(), save()

### Community 101 - "notification-core.js"
Cohesion: 0.52
Nodes (6): claim(), clearBinding(), db(), get(), prune(), put()

### Community 102 - "notifications-sw.js"
Cohesion: 0.48
Nodes (5): closeCall(), deliver(), foreground(), inScope(), reconcileCalls()

### Community 103 - "FileManager.tsx"
Cohesion: 0.05
Nodes (84): tus-js-client@^4.3.1, tus-js-client, AuthenticatedThumbnail(), dateLabel(), EmptyState(), Entry, FileCard(), fileIcon() (+76 more)

### Community 105 - "admin-statistics-reset-db.mjs"
Cohesion: 0.43
Nodes (5): actor(), dashboard(), db, query(), reset()

### Community 106 - "main"
Cohesion: 0.38
Nodes (5): main(), command(), http(), jwt(), sql()

### Community 108 - "build-report.mjs"
Cohesion: 0.40
Nodes (4): counts, findingMd, findings, link()

### Community 110 - "file-previews-diagnostic.mjs"
Cohesion: 0.40
Nodes (3): menu(), names, open()

### Community 111 - "content-context-db-diagnostic.mjs"
Cohesion: 0.11
Nodes (8): db, env, headers, results, script, objects, offsets, xref

### Community 112 - "deploy.sh"
Cohesion: 0.53
Nodes (5): enforce_private_realtime(), runtime_stack(), deploy.sh script, STREAMLY_PROJECT_ROOT, STREAMLY_REALTIME_SEED

### Community 114 - "temporary-share/index.ts"
Cohesion: 0.40
Nodes (3): headers, json(), unavailable()

### Community 116 - "file-previews.mjs"
Cohesion: 0.40
Nodes (3): menu(), names, open()

### Community 126 - "constants.js"
Cohesion: 0.40
Nodes (4): extglobChars(), POSIX_CHARS, POSIX_REGEX_SOURCE, WINDOWS_CHARS

## Knowledge Gaps
- **3 isolated node(s):** `STREAMLY_PROJECT_ROOT`, `STREAMLY_REALTIME_SEED`, `STREAMLY_PROJECT_ROOT`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 1192 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `supabase.ts`, `AuthContext.tsx`, `lucide-react`, `Messenger.tsx`, `dependencies`, `AdminPage.tsx`, `FileManager.tsx`, `CallPanel.tsx`, `AdminStatistics.tsx`, `TaskModal`, `appHistory.ts`, `TemporaryShareModal.tsx`, `media-reactions-harness.tsx`, `package.json`, `useVideoPresentation.ts`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **What connects `STREAMLY_PROJECT_ROOT`, `STREAMLY_REALTIME_SEED`, `STREAMLY_PROJECT_ROOT` to the rest of the system?**
  _3 weakly-connected nodes found - possible missing edges._
- **Should `supabase.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.03677685950413223 - nodes in this community are weakly interconnected._
- **Why does `@supabase/supabase-js` connect `supabase.ts` to `AuthContext.tsx`, `dependencies`, `library-storage-links-http.mjs`, `media-reactions-harness.tsx`, `package.json`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Should `AuthContext.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08032786885245902 - nodes in this community are weakly interconnected._
- **Why does `typescript` connect `ref_node_fs` to `temporary-share-server.mjs`, `library-storage-links-http.mjs`, `messenger-call-engine.mjs`, `ref_node_crypto`, `package.json`, `devDependencies`, `@electric-sql/pglite`, `audit-client-resilience.mjs`, `folder-uploads.mjs`, `picomatch-security.mjs`, `group-media-upload-db.mjs`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Should `lucide-react` be split into smaller, more focused modules?**
  _Cohesion score 0.09437751004016064 - nodes in this community are weakly interconnected._