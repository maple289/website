# MyHostage production audit — 11–12 October 2026

| Severity | Findings |
|---|---:|
| CRITICAL | **0** |
| HIGH | **6** |
| MEDIUM | **11** |
| LOW | **7** |
| INFORMATIONAL | **2** |

**Overall production-health assessment: operational at the application boundary, with significant authorization, deployment and recovery risks.** Public pages/API reads responded; private/admin pages loaded after recovery from a confirmed stale-chunk crash; a real PC–iPhone voice call had user-confirmed two-way audio. The available evidence does **not** establish complete Ubuntu service health, database/filesystem integrity, backup recoverability or live video/hardware routing compliance.

The counts describe the finding register, **not 26 confirmed live exploits**. Confidence and scope are stated separately for every entry. High findings include locally reproduced authorization defects, a live deployment failure, a storage-location design risk, a concurrency risk and a recovery-readiness evidence gap. No Critical finding was substantiated by the access available. This does not certify that inaccessible systems contain none.

## Scope, safety and evidence

- Site: `myhostage.ca`, application mounted at `/video/`, with hash-based navigation. Public root is a separate legacy/front-door response.
- Source examined: repository HEAD `5c26cf7` (latest complete-message-card deletion change). This is the examined source revision, **not a verified complete production release/migration SHA**.
- Live access: existing signed-in administrator browser and a dedicated iPhone test account. Phone described by the user as latest iOS, Firefox; exact browser/OS versions were not recorded.
- Host access: one noninteractive SSH key attempt was rejected. The user instructed proceeding with available access and marking server checks unverified. No password retries or further SSH access requests were made.
- Production activity: ordinary read-only browsing/API probes and short explicitly authorized test calls. Photo viewing can record normal view analytics; calls retain ordinary call-history events. No user files/messages/accounts/shares were deleted, no production uploads/registrations/emails were submitted, and no settings, migrations, router, ASA or TURN configuration were changed.
- Local diagnostics: actual application components, SQL/RLS/functions and Edge branches with synthetic accounts/storage/provider/media fixtures. These establish logic behavior within their fixtures, not physical storage, full Supabase deployment behavior or real phone hardware/network behavior.
- No production source remediation was performed. Audit evidence and this report are separate workspace artifacts. No secret values, session tokens or private message bodies are included in the report.

Evidence files in this directory include `public-health.json`, `auth-boundaries.json`, `admin-deletion-race.json`, `findings.json`, test logs, responsive measurements and explicitly labeled fixture screenshots. Some initial logs retain unsuccessful **diagnostic/environment** attempts; the test-results table identifies final outcomes. Raw dependency advisory counts are not mapped one-to-one to application findings.

## Architecture established from current source

| Layer | Actual implementation and entry points | Verification boundary |
|---|---|---|
| Frontend | React 18.3.1, TypeScript, Vite 5.4.8, Tailwind, Lucide, PDF.js 6.3.289. `src/main.tsx` → `src/App.tsx`; lazy pages and hash routes. Shared deletion/modal/context-menu infrastructure. | Source and deployed pages/bundles inspected. |
| Backend | Self-hosted Supabase release marker `self-hosted/v0.7.0`: Kong, GoTrue Auth, PostgREST, Storage, Realtime, Deno Edge functions. Supabase JS 2.57.4. PostgreSQL SQL migrations/RPCs/RLS; **no ORM and no Socket.IO** found. | Runtime topology inferred from supplied deployment files; actual running versions/containers unavailable. |
| Authentication | Email is the login identifier; optional first/last names; admin approval and initial-password workflow; Supabase access/refresh tokens plus custom refresh, persistence and cross-tab sign-out controls. | Source, local Auth-client session fixtures and live signed-in access. Production activation/password mutations not attempted. |
| Messenger | SQL RPC authorization/membership/block rules; private Supabase Realtime user channels, typing/presence, catch-up/paging and heartbeat fallback. Unique direct pair plus locking; direct and group chats. Deletion visibility/tombstones preserve reply references and cleanup queues. | SQL/provider/UI fixtures and live directory/voice conversation. No live destructive chat tests. |
| Calls | Explicit `voice`/`video` state; WebRTC peer engine, perfect-negotiation/candidate handling, bounded group mesh, versioned explicit camera state, poll cursors, ringtones and cleanup. Full call-container fullscreen/fallback and draggable/corner self-view. | Source, SQL/engine/browser fixtures; real voice audio confirmed. Real video denied camera capture in connected browser. |
| TURN credentials | Authenticated call-session-gated Edge endpoint; HMAC-generated temporary credentials, 3,600-second TTL, credential issuance throttle; direct P2P and TURN configuration retained. | Local handler/RPC tests. Actual coturn, UDP/TCP relay paths and timer state unverified; no network configuration changed. |
| Uploads/media | Browser content validation and regular/TUS upload to staging; durable job claims/fences; Python media worker performs actual decode/probe, bounded processing, object verification and atomic Ready/job publication. FFmpeg/FFprobe argument arrays; Pillow/HEIF previews. Video limit 10 GiB, photo limit 25 MiB in source. | Source inspection. Linux/container decoder, interrupted job and production concurrency suites not run on this Windows audit host. |
| Documents | `file-preview` Edge path, reauthorization, private preview cache/job pipeline; LibreOffice/UNO renderer for Office/spreadsheets; PDF.js/browser image/text/CSV rendering. Clean renderer environment, separate unprivileged UID/network restrictions, bounded worker resources and suspicious Office archive checks. | Source and 32 browser fixture groups; actual production LibreOffice output/page fidelity unavailable. |
| Storage | Supabase buckets/catalog and file metadata/share identities. Documented host roots under `/srv/streamly/supabase/volumes/storage`; DB under `/srv/streamly/supabase/volumes/db/data`; backups `/srv/streamly/backups`. | These are documented deployment paths, not verified mounts, ownership, symlinks or physical inventories. |
| Workers/jobs | Supplied `deploy/media-worker.compose.yml`, `messenger.compose.yml`, `file-preview-worker.compose.yml`, `analytics-collector.compose.yml` and Auth/email overrides. Media/receipt/preview cleanup and analytics collection use durable DB state/heartbeats. | Actual container health, concurrency, scheduled timers and host jobs unverified. |
| Proxy/deployment | `docker/Caddyfile` serves frontend and proxies API paths toward Kong. Public response reports IIS, consistent with a front-door/subpath deployment. CI/self-hosted deploy scripts build source, take DB backup and apply forward migrations. | Front-door response verified; actual IIS/upstream configuration and migration ledger inaccessible. |
| Configuration | Runtime environment and database storage/bitrate settings; privileged credentials kept in backend/worker configuration. | Names/flows inspected without dumping environment values. Server secrets/config permissions inaccessible. |

## Baseline health observations

| Check | Result |
|---|---|
| Public root/application | Ordinary GETs returned 200. Application available at `/video/`. |
| Public media access | Anonymous database reads returned three public videos and four public photos, with zero non-public rows in these results. This checks those queries, not every policy/resource. |
| Private objects/admin boundary | Anonymous profile/pending-registration/storage-setting reads returned no rows; Messenger messages/attachments/temporary-share table queries were rejected; tested admin/storage/media Edge requests without a session were rejected. A separate correct-method POST call-configuration probe returned 401 with private, no-store caching, without creating a call or TURN credentials (`public-call-auth.json`). |
| Opaque public Files API | One root entry returned through the public listing RPC, with no owner storage keys in the checked response. Invalid public-file ID returned 404. |
| Temporary route | `/video/share/<synthetic-invalid-token>` reached the isolated share application route; `/share/<synthetic-invalid-token>` at the legacy root returned 404. Current generator root/subpath hosting fixtures pass. No supplied historical real capability was opened or printed during this audit. |
| Admin system-load display | Updated live, discovered **12 logical CPUs**; observed low CPU (approximately 3–7%), RAM approximately 35%, no queued/converting media jobs in that UI sample. Source discovers `/proc/stat` CPUs dynamically. This is collector/UI evidence, not a host health inventory. |
| Admin statistics sample | UI reported four users, seven videos, four photos, two files, 5.45 GB application storage, 18.24 TB free disk and 0.2% disk usage. These UI values were **not reconciled independently with DB/filesystem**, so accuracy is unverified. |
| API timing | Small ordinary REST probes generally around 12–30 ms; selected Edge probes around 500–550 ms from this host. One finite sample, no percentile/SLA or load-test claim. |
| Missing lazy asset | Confirmed whole-app failure in stale tab; absent JS chunk returned HTML with immutable caching. Reload restored access. See A03. |
| Ubuntu/systemd/DB/coturn/workers/logs | **Unverified**: no host terminal access. Public service response or an admin dashboard does not substitute for these checks. |
| Public `/healthz` | Returned 404 at the public front door; the documented health path is internal. This does not prove that the application service is unhealthy. |

## Recommended remediation order

| Phase | Priorities |
|---|---|
| **1 — Critical/security/data-loss** | A01 initial-account ownership proof; A02 disabled-account authorization; A05 transactional last-admin invariant; verify A06 full recovery coverage and A16 backup confidentiality. Inspect actual host state before any data-location migration. |
| **2 — Functional bugs** | A03 deployment/chunk recovery; A04/A18 storage-setting semantics and existing-content locations; A13 cache recovery; A19 stale external-link setting; resolve A24 administrator playback policy. |
| **3 — Integrity/reliability** | A08 durable transfers; A12 mail-ledger replay; A17 current reconciliation coverage; complete deferred production integrity, job recovery and cleanup-queue inspections. |
| **4 — Performance** | A09 bounded downloads; measure actual slow-query plans, large result sets and preview/worker throughput with non-disruptive sampling. |
| **5 — UX/responsive** | A20 confirmed active-device display; A21 text encoding; finish real camera/fullscreen/audio-route checks (I01/I02), including mobile landscape and the actual selected PC microphone. |
| **6 — Technical debt** | A14 dependency patches; A15 CI gates; A22 fixture drift; A23 generated artifacts; stage header hardening (A10) and registration quotas (A11) with their security priorities. |

Each remediation should have its own reviewable scope, staged regression tests and rollback plan. This report does not authorize silently changing production or deleting inventory inconsistencies.

## Finding register

