# Graph Report - Project  (2026-11-21)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2653 nodes · 6007 edges · 147 communities (106 shown, 41 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 90 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b85f198b`
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
- ref_node_crypto
- react-dom
- messenger-call-engine.mjs
- pathlib
- subprocess
- messenger-notifications-worker.mjs
- env
- build_user_guide_en.py
- analytics-collector
- FilePreview.tsx
- PublicationTests
- uuid
- ref_npm_supabase
- FileManager.tsx
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
- fileTree.ts
- @electric-sql/pglite
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
- messenger-group-sharing-harness.tsx
- FakeSession
- package.json
- group-media-upload-db.mjs
- workspace_fixture
- temporary-share-server.mjs
- picomatch
- Peer
- settings-navigation-diagnostic.mjs
- os
- dependencies
- CollectorTests
- notify-admin-registration/index.ts
- email.ts
- Peer
- settings-navigation.mjs
- environment
- environment
- eslint.config.js
- ReactionStore
- messenger-media/index.ts
- media-double-tap.mjs
- pdf-preview-access.mjs
- shared-image-gateway.mjs
- utils.js
- parse.js
- picomatch/package.json
- scripts
- diagnose-registration-email.py
- messenger-message-deletion.mjs
- messenger-people.mjs
- unicode-file-names.mjs
- audit-client-resilience.mjs
- library-storage-links-db.mjs
- media-uploads.mjs
- PushTests
- parse
- test-file-sharing.mjs
- test-registration-email.mjs
- FileTypeIcon.tsx
- storage-file-catalog.mjs
- storage-preview-cache.mjs
- notification-core.js
- notifications-sw.js
- FileTree.tsx
- SystemLoadWidget.tsx
- admin-statistics-reset-db.mjs
- main
- media-reactions.mjs
- build-report.mjs
- content-context-db-diagnostic.mjs
- file-previews-diagnostic.mjs
- public-health.mjs
- deploy.sh
- library-storage-sign/index.ts
- temporary-share/index.ts
- content-context-db.mjs
- file-previews.mjs
- CleanupPlanTests
- ReadinessTests
- CopyPlan
- public-call-auth.mjs
- pdf-preview.mjs
- messenger-calls/index.ts
- GatewayTemplate
- MigrationPreparation
- public-preview-access.mjs
- constants.js
- apply-migrations.sh
- backup-full.sh
- tsconfig.json
- mcp.json
- start-web.sh
- @types/react@^18.3.5
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
4. `lucide-react` - 47 edges
5. `FileManager()` - 45 edges
6. `TaskModal` - 39 edges
7. `useDeleteConfirmation()` - 38 edges
8. `CallEngine` - 37 edges
9. `useGuardedClose()` - 34 edges
10. `DeleteConfirmationProvider()` - 33 edges

## Surprising Connections (you probably didn't know these)
- `query()` --indirect_call--> `container()`  [INFERRED]
  tests/interruption-integrity.py → services/media-worker/validate.py
- `ready()` --indirect_call--> `container()`  [INFERRED]
  tests/interruption-integrity.py → services/media-worker/validate.py
- `Window` --references--> `validateMediaFile()`  [EXTRACTED]
  tests/media-upload-harness.tsx → src/lib/mediaValidation.ts
- `Harness()` --calls--> `DeleteConfirmationProvider()`  [EXTRACTED]
  tests/file-integrity-harness.tsx → src/components/DeleteConfirmationProvider.tsx
- `Harness()` --calls--> `DeleteConfirmationProvider()`  [EXTRACTED]
  tests/file-previews-harness.tsx → src/components/DeleteConfirmationProvider.tsx

## Import Cycles
- 2-file cycle: `src/lib/authSession.ts -> src/lib/notifications.ts -> src/lib/authSession.ts`

## Communities (147 total, 41 thin omitted)

### Community 0 - "supabase.ts"
Cohesion: 0.04
Nodes (57): DeleteConfirmationProvider(), Pending, ReactionProvider(), AuthContext, FileClipboardProvider(), DeleteConfirmation, DeleteConfirmationContext, supabase (+49 more)

### Community 1 - "AuthContext.tsx"
Cohesion: 0.08
Nodes (61): @supabase/supabase-js, NotificationSettings(), AuthContextValue, AuthProvider(), clearSavedPasswordSetup(), PasswordSetup, readableError(), empty (+53 more)

### Community 2 - "lucide-react"
Cohesion: 0.12
Nodes (44): lucide-react, ContentAction, ContentContextMenu(), MenuAnchor, EditPhotoModal(), EditVideoModal(), EditVideoModalProps, FileDropArea() (+36 more)

### Community 3 - "Messenger.tsx"
Cohesion: 0.09
Nodes (49): ConversationPane(), currentConversation(), Draft, MessageItem(), MessageReactions(), Messenger(), newDraft(), AdminGroups() (+41 more)

### Community 4 - "CallEngine"
Cohesion: 0.09
Nodes (15): browser, Peer, ToneContext, CallSession(), CallEngine, emptyCallState, friendly(), Peer (+7 more)

### Community 5 - "ref_node_fs"
Cohesion: 0.04
Nodes (35): admins, barrier, createClient(), result, db, results, typescript, target (+27 more)

### Community 6 - "react"
Cohesion: 0.09
Nodes (37): react, App(), AppContent(), getRoute(), Messenger, NavItem(), Route, UserStatistics (+29 more)

### Community 7 - "AdminPage.tsx"
Cohesion: 0.08
Nodes (44): AddUserModal(), AdminPage(), AdminStatistics, AuthHeadersFn, ChangeRoleModal(), EditUserModal(), PendingRegistration, PendingRegistrations() (+36 more)

### Community 8 - "ref_node_path"
Cohesion: 0.07
Nodes (24): playwright@^1.58.2, playwright, vite, @vitejs/plugin-react, suites, completeFrame(), geometry(), open() (+16 more)

### Community 9 - "CallPanel.tsx"
Cohesion: 0.08
Nodes (27): ActiveCall(), Avatar(), corners, duration(), ExpiredNotificationCall(), Media(), RemoteVideo(), SelfView() (+19 more)

### Community 10 - "AdminStatistics.tsx"
Cohesion: 0.12
Nodes (43): activityColumns, AdminStatistics(), fileColumns, mediaColumns, OwnerFilter(), sections, StorageDetails(), SummaryCards() (+35 more)

### Community 11 - "TaskModal"
Cohesion: 0.10
Nodes (35): BatchUploadModal(), Item, PhotoUploadModal(), PhotoUploadModalProps, TaskModal, UploadModal(), UploadModalProps, MediaGroup (+27 more)

### Community 12 - "ref_node_assert"
Cohesion: 0.04
Nodes (10): jwt, user, browser, photoFile, videoFile, browser, directoryCalls, assertPublic() (+2 more)

### Community 13 - "media-receipt-cleanup"
Cohesion: 0.05
Nodes (43): context, GLOBAL_S3_BUCKET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, TENANT_ID, interval, retries, start_period (+35 more)

### Community 14 - "time"
Cohesion: 0.09
Nodes (17): dispatch_once(), main(), deliver(), endpoint_allowed(), load_key(), main(), PushSession, rpc() (+9 more)

### Community 15 - "ref_node_crypto"
Cohesion: 0.05
Nodes (23): admin, options, outer, privateUrl, raw, resource, rows, source (+15 more)

### Community 16 - "react-dom"
Cohesion: 0.10
Nodes (32): react-dom, MediaReactions(), Person, Props, ReactionBar(), ReactionControl(), ReactionDetails(), reactionViewport() (+24 more)

### Community 17 - "messenger-call-engine.mjs"
Cohesion: 0.05
Nodes (20): accepting, browser, call, captured, connectionPeer, delayed, engine, exports (+12 more)

### Community 18 - "pathlib"
Cohesion: 0.09
Nodes (4): Response, DiagnosticsTests, Response, StorageAudit

### Community 19 - "subprocess"
Cohesion: 0.09
Nodes (18): identifier(), inspect_snapshot(), issue(), reference(), main(), query(), prepare(), main() (+10 more)

### Community 20 - "messenger-notifications-worker.mjs"
Cohesion: 0.06
Nodes (31): active, alreadyAnswered, anotherOwner, binding, call, close, context, conversation (+23 more)

### Community 21 - "env"
Cohesion: 0.06
Nodes (35): concurrency, cancel-in-progress, group, env, if, runs-on, steps, timeout-minutes (+27 more)

### Community 22 - "build_user_guide_en.py"
Cohesion: 0.08
Nodes (12): GuideCanvas, GuideDoc, inline(), screenshot(), shot_flow(), visual(), GuideCanvas, GuideDoc (+4 more)

### Community 23 - "analytics-collector"
Cohesion: 0.06
Nodes (33): build, cap_drop, cpus, environment, healthcheck, image, mem_limit, pids_limit (+25 more)

### Community 24 - "FilePreview.tsx"
Cohesion: 0.12
Nodes (22): FilePreview(), PdfFilePreview, State, FilePreview, clampZoom(), PdfFilePreview(), PdfPreviewBoundary, PdfPreviewUnavailable() (+14 more)

### Community 25 - "PublicationTests"
Cohesion: 0.10
Nodes (4): BitrateDecisions, PublicationTests, api(), validate()

### Community 26 - "uuid"
Cohesion: 0.11
Nodes (10): collect(), main(), rpc(), cpu_counters(), cpu_usage(), memory_usage(), monitor(), clean_receipts() (+2 more)

### Community 27 - "ref_npm_supabase"
Cohesion: 0.08
Nodes (9): corsHeaders, headers, headers, headers, headers, headers, headers, headers (+1 more)

### Community 28 - "FileManager.tsx"
Cohesion: 0.14
Nodes (30): AuthenticatedThumbnail(), dateLabel(), EmptyState(), Entry, FileCard(), fileIcon(), FileManager(), entryFromMetadata() (+22 more)

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
Cohesion: 0.14
Nodes (11): allocate(), attribute(), packet(), parse(), receive(), block_network(), convert(), validate_legacy_workbook() (+3 more)

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

### Community 40 - "fileTree.ts"
Cohesion: 0.19
Nodes (17): drain(), FileVideoThumbnail(), pending, FolderDestinationPicker(), FileLocation, FileObject, listFileObjects(), resolveFileLocation() (+9 more)

### Community 41 - "@electric-sql/pglite"
Cohesion: 0.11
Nodes (13): @electric-sql/pglite@^0.5.8, @electric-sql/pglite, db, actor(), db, queue(), reserve(), sql() (+5 more)

### Community 42 - "audit-storage-layout.py"
Cohesion: 0.18
Nodes (13): checksum(), identifier(), inspect_files(), key(), local_file(), main(), make_manifest(), add() (+5 more)

### Community 43 - "validate.py"
Cohesion: 0.19
Nodes (10): RealBitrateConversions, container(), InvalidMedia, measured_bitrate(), mp4_faststart(), number(), photo(), probe() (+2 more)

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
Cohesion: 0.22
Nodes (12): TemporaryShareModal(), Item, TemporarySharePage(), appBasePath(), temporarySharePath(), temporaryShareRoute(), createTemporaryLink(), getTemporaryLink() (+4 more)

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
Cohesion: 0.14
Nodes (14): devDependencies, eslint@^9.39.5, picomatch@file:vendor/picomatch, postcss@^8.5.29, @tailwindcss/postcss@^4.3.3, @types/react-dom@^18.3.0, typescript@^5.5.3, vite@^7.3.7 (+6 more)

### Community 58 - "account-login/index.ts"
Cohesion: 0.21
Nodes (6): hash(), headers, hex(), InputError, readSmallJson(), corsHeaders

### Community 59 - "messenger-group-sharing-harness.tsx"
Cohesion: 0.14
Nodes (11): auth, library, photo, role, root, session, subscribe(), unsubscribe() (+3 more)

### Community 61 - "package.json"
Cohesion: 0.15
Nodes (12): tailwindcss@^4.3.3, @types/tus-js-client@^1.8.0, name, overrides, picomatch, @typescript-eslint/typescript-estree, private, type (+4 more)

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

### Community 68 - "os"
Cohesion: 0.42
Nodes (8): auth_config(), backup(), directives(), main(), publish(), restart(), restore(), write()

### Community 69 - "dependencies"
Cohesion: 0.17
Nodes (11): dependencies, lucide-react@^0.446.0, pdfjs-dist@6.3.289, react@^18.3.1, react-dom@^18.3.1, @supabase/supabase-js@^2.57.4, tus-js-client@^4.3.1, pdfjs-dist (+3 more)

### Community 70 - "CollectorTests"
Cohesion: 0.23
Nodes (3): CollectorTests, walk(), rpc()

### Community 71 - "notify-admin-registration/index.ts"
Cohesion: 0.26
Nodes (6): corsHeaders, corsHeaders, customerEmailsEnabled(), deliverEmail(), escapeHtml(), registrationTemplate()

### Community 72 - "email.ts"
Cohesion: 0.36
Nodes (10): configuredSender(), deliverEmailImpl(), EmailResult, safeEmailLog(), sendEmail(), appendTemporaryPassword(), approvalPassword(), encode() (+2 more)

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

### Community 80 - "media-double-tap.mjs"
Cohesion: 0.22
Nodes (3): click(), openPhoto(), openVideo()

### Community 81 - "pdf-preview-access.mjs"
Cohesion: 0.24
Nodes (8): createClient(), db, fetchStorage(), formatExports, install(), log, sql(), tokens

### Community 82 - "shared-image-gateway.mjs"
Cohesion: 0.18
Nodes (6): access, admin, env, headers, resource, rows

### Community 84 - "parse.js"
Cohesion: 0.42
Nodes (10): analyzeRepeatedExtglob(), buildCharClassStar(), getStarExtglobSequenceChars(), hasRepeatedCharPrefixOverlap(), hasUnboundedRepeat(), isPlainBranch(), normalizeSimpleBranch(), parseRepeatedExtglob() (+2 more)

### Community 85 - "picomatch/package.json"
Cohesion: 0.18
Nodes (10): description, engines, node, files, license, main, name, private (+2 more)

### Community 86 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, lint, prebuild, predev, preview, test:core (+2 more)

### Community 88 - "messenger-message-deletion.mjs"
Cohesion: 0.22
Nodes (6): a, b, chat(), db, sql(), stranger

### Community 89 - "messenger-people.mjs"
Cohesion: 0.22
Nodes (6): a, b, chat(), db, outsider, sql()

### Community 90 - "unicode-file-names.mjs"
Cohesion: 0.27
Nodes (7): db, decode(), key(), location(), other, owner, sql()

### Community 91 - "audit-client-resilience.mjs"
Cohesion: 0.22
Nodes (4): entry, folderModule, publicModule, settingsModule

### Community 92 - "library-storage-links-db.mjs"
Cohesion: 0.28
Nodes (8): check(), db, otherSid, owner, resolve(), sid, sql(), viewer

### Community 93 - "media-uploads.mjs"
Cohesion: 0.25
Nodes (7): check(), corrupt, errors, executable, goodPhoto, goodVideo, setup()

### Community 95 - "parse"
Cohesion: 0.31
Nodes (8): globChars(), expandRange(), parse(), syntaxError(), escapeLast(), escapeRegex(), hasRegexChars(), removePrefix()

### Community 96 - "test-file-sharing.mjs"
Cohesion: 0.39
Nodes (7): check(), db, denied(), login(), query(), readable(), save()

### Community 97 - "test-registration-email.mjs"
Cohesion: 0.25
Nodes (5): client, db, env, logs, sent

### Community 98 - "FileTypeIcon.tsx"
Cohesion: 0.32
Nodes (6): documents, extensionCategories, FileCategory, fileCategoryLabels, fileExtension(), mimeCategories

### Community 99 - "storage-file-catalog.mjs"
Cohesion: 0.29
Nodes (5): db, location(), other, owner, sql()

### Community 100 - "storage-preview-cache.mjs"
Cohesion: 0.32
Nodes (4): db, object(), queue(), sql()

### Community 101 - "notification-core.js"
Cohesion: 0.52
Nodes (6): claim(), clearBinding(), db(), get(), prune(), put()

### Community 102 - "notifications-sw.js"
Cohesion: 0.48
Nodes (5): closeCall(), deliver(), foreground(), inScope(), reconcileCalls()

### Community 103 - "FileTree.tsx"
Cohesion: 0.48
Nodes (6): Branch, FileTree(), hierarchy(), Node, ancestorPaths(), searchTreeEntries()

### Community 104 - "SystemLoadWidget.tsx"
Cohesion: 0.48
Nodes (6): gib(), Meter(), percent(), Props, SystemLoadWidget(), SystemLoad

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

### Community 111 - "public-health.mjs"
Cohesion: 0.33
Nodes (4): env, headers, results, script

### Community 112 - "deploy.sh"
Cohesion: 0.53
Nodes (5): enforce_private_realtime(), runtime_stack(), deploy.sh script, STREAMLY_PROJECT_ROOT, STREAMLY_REALTIME_SEED

### Community 114 - "temporary-share/index.ts"
Cohesion: 0.40
Nodes (3): headers, json(), unavailable()

### Community 116 - "file-previews.mjs"
Cohesion: 0.40
Nodes (3): menu(), names, open()

### Community 120 - "public-call-auth.mjs"
Cohesion: 0.40
Nodes (4): key, page, result, source

### Community 126 - "constants.js"
Cohesion: 0.40
Nodes (4): extglobChars(), POSIX_CHARS, POSIX_REGEX_SOURCE, WINDOWS_CHARS

## Knowledge Gaps
- **3 isolated node(s):** `STREAMLY_PROJECT_ROOT`, `STREAMLY_REALTIME_SEED`, `STREAMLY_PROJECT_ROOT`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 1174 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **41 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@supabase/supabase-js` connect `AuthContext.tsx` to `supabase.ts`, `dependencies`, `react`, `ref_node_crypto`, `react-dom`, `messenger-group-sharing-harness.tsx`, `package.json`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **What connects `STREAMLY_PROJECT_ROOT`, `STREAMLY_REALTIME_SEED`, `STREAMLY_PROJECT_ROOT` to the rest of the system?**
  _3 weakly-connected nodes found - possible missing edges._
- **Should `supabase.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.03980782429649966 - nodes in this community are weakly interconnected._
- **Why does `react` connect `react` to `supabase.ts`, `AuthContext.tsx`, `lucide-react`, `Messenger.tsx`, `AdminPage.tsx`, `CallPanel.tsx`, `AdminStatistics.tsx`, `TaskModal`, `react-dom`, `FilePreview.tsx`, `FileManager.tsx`, `useVideoPresentation.ts`, `fileTree.ts`, `appHistory.ts`, `TemporaryShareModal.tsx`, `messenger-group-sharing-harness.tsx`, `package.json`, `dependencies`, `FileTree.tsx`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Should `AuthContext.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07536231884057971 - nodes in this community are weakly interconnected._
- **Why does `typescript` connect `ref_node_fs` to `temporary-share-server.mjs`, `test-registration-email.mjs`, `ref_node_path`, `@electric-sql/pglite`, `ref_node_crypto`, `messenger-call-engine.mjs`, `picomatch-security.mjs`, `pdf-preview-access.mjs`, `shared-image-gateway.mjs`, `messenger-notifications-worker.mjs`, `devDependencies`, `audit-client-resilience.mjs`, `package.json`, `group-media-upload-db.mjs`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Should `lucide-react` be split into smaller, more focused modules?**
  _Cohesion score 0.11778846153846154 - nodes in this community are weakly interconnected._