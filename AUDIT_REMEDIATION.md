# Audit remediation — 12 October 2026

The application changes below are implemented locally and tested with synthetic
accounts, an isolated PostgreSQL engine and browser fixtures. **Nothing in this
remediation has been deployed to production.** No production records, uploads,
accounts or messages were deleted. Router/ASA and TURN networking were unchanged.

The original audit remains at `audit/20261011/REPORT.md`: **0 substantiated
Critical, 6 High, 11 Medium, 7 Low and 2 Informational** findings. Those counts
describe the audited deployment; local source changes do not close production
findings. Application corrections are prepared for A01–A05 and A07–A24. A06 has
backup tooling prepared but remains operationally open until an off-host repository
and a successful recovery rehearsal exist.

## Findings and prepared corrections

| ID | Severity | Correction and source | Validation / remaining work |
|---|---|---|---|
| A01 | High | `account-login`, Auth context and Initial Password page require a mailbox-delivered, single-use verification code. It is never returned in the public login response or saved in frontend setup state. Migration `20261012010000` invalidates old capabilities and retires the old issuer before deploying the new one. | Actual SQL/handler tests cover unauthorized code guessing, reuse, hash storage, old-issuer retirement and successful mailbox-code activation. Configure/verify Resend before rollout; missing mail configuration fails closed. |
| A02 | High | The same migration adds active-account checks to existing authenticated RLS, redefines `is_admin`, and installs a PostgREST pre-request gate for privileged RPCs. Admin Edge handlers use the authenticated permission RPC. | Old bearer claims lose owner/admin access after disablement in actual SQL. Verify the Auth/REST/Storage integration and any existing pre-request hook on a staging clone. |
| A03 | High | `docker/Caddyfile`, `docker/start-web.sh`, Compose and deployment script retain previous hashed assets for fourteen days, seed the running build at cutover, and return a non-cacheable 404 for missing assets. Page/Admin statistics error boundaries preserve navigation and the separate call provider/panel. | A failed Messenger chunk preserves incoming call controls and recovers on navigation in a browser fixture. Official Caddy 2.10.2 validates the configuration; its actual local routes pass missing/retained asset and cache tests. Docker/IIS cutover still needs staging. |
| A04 | High | Storage UI/handler describe bucket-relative prefixes, normalize slashes, and reject settings that would strand existing media. Migration `20261012020000` serializes prefix changes with publication/catalog writes. Physical mounts require an operator storage migration. | Actual SQL rejects a changed populated prefix while allowing unchanged roots and bitrate saves. No media paths/bytes were migrated. |
| A05 | High | `20261012010000` protects the last active administrator against Auth deletion, profile deletion/demotion, bans, soft deletion and activation disablement. Existing account deletion continues through Auth and the shared confirmation. | Actual SQL denies deletion/demotion/ban of the last active admin. Cross-session/concurrent Auth API transactions still need staging PostgreSQL verification. |
| A06 | High | `scripts/backup-full.sh`, proposed systemd units, `deploy/backup.env.example` and `BACKUP_RECOVERY.md` prepare private, encrypted off-host DB/content/config backups and a recovery procedure. Existing pre-deployment DB-only backups remain. | Shell syntax checked. **Open:** actual repository, password recovery, service installation, first snapshot, monitoring and isolated restore rehearsal. No destination was guessed or activated. |
| A07 | Medium | `serve-media` and `20261012030000` replace returned one-hour Storage signed URLs with hashed playback grants. Every GET/HEAD/Range rechecks the current item, visibility, account, Auth session and grant expiry before streaming bytes. Grants are bounded and deleted with content/accounts. | Actual SQL/handler tests cover owner/admin/session identity, disablement, accepted-server-sign-out session removal, expiry, private changes, deletion and byte-range forwarding. Previously issued Storage URLs can remain valid until their existing one-hour expiry. |
| A08 | Medium | `20261012040000`, `fileOperations.ts` and File Manager persist immutable transfer plans and confirmed steps on the server. Reloaded transfers can resume; changed sources/destinations and uncertain copies stop for review. Confirmed **Stop tracking** retains completed files and removes recovery tracking without rollback/deletion. | Actual SQL plus desktop/mobile UI prove reload recovery, lost Move response detection, complete folder contents, no false Trash-name conflict, user isolation and conflict guards. Storage and DB are still separate systems; uncertain copies deliberately require review rather than guessed completion. |
| A09 | Medium | Folder downloads enforce a 64 MiB aggregate browser archive budget. Metadata rejects obvious oversized payloads before download; stream readers enforce the remaining budget and cancel oversized responses, including unknown-length streams. | Original ZIP opens in a standard reader with Unicode names/nested and empty folders. Bounded-download tests cover advertised and actual overflow. Larger folders must currently be downloaded as individual files. |
| A10 | Medium | Caddy adds HSTS, CSP and Permissions Policy; `deploy/iis-security-headers.config.example` supplies an additive front-door fragment. CSP permits required fonts/media/PDF workers and WebAssembly compilation, while executable JS stays same-origin. | Actual local Caddy headers pass, including self JS, blocked inline JS and allowed WASM. IIS configuration has not been applied or inspected on the host. Validate effective headers on root, `/video/`, `/share/`, assets and error responses after staging; exercise PDF/WASM previews under the actual policy. |
| A11 | Medium | Shared bounded JSON parsing limits public request bodies to 8 KiB. A private database budget caps registration at 20/minute and 200/hour, and initial-code issuance at 100/hour with a per-account cooldown. | Actual handler rejects oversized input; actual DB budget persists and is unavailable to browser roles. Trusted-proxy/client-specific throttling remains an operator configuration choice; no untrusted forwarding header is treated as identity. |
| A12 | Medium | New `services/email-dispatcher/dispatcher.py` and Compose service periodically retry eligible saved mail with the existing DB claim, bounded attempts and the same provider idempotency key. Missing configuration does not consume attempts. Unsafe/expired retry windows require operator review. | Existing 65 mail/ledger/approval checks and isolated dispatcher tests pass without sending email. Activate worker and confirm real provider delivery/monitoring on staging. |
| A13 | Medium | `storageSettings.ts` uses a 30-second TTL, explicit invalidation after successful saves, normalized bucket roots, and retryable failures rather than cached empty defaults. | Tests prove failure retry, TTL expiry and invalidation. |
| A14 | Medium | Vite, React plugin, lint tooling and compatible transitive packages were refreshed. Unpatched Tailwind 3 build dependencies were removed by a reviewed Tailwind 4/PostCSS migration with compatibility border styling and explicit source scanning. | `npm audit` reports **zero vulnerabilities**, type/lint/build and responsive browser suites pass. This scan covers npm dependencies, not OS images/Python/Edge runtime inventories. |
| A15 | Medium | `.github/workflows/ci.yml` makes lint blocking and adds dependency, actual-SQL/security, Messenger, transfer, mobile-auth, sharing, preview, email, reconciliation and Caddy checks. Reproducible PGlite/Playwright dependencies and fixture generators replace local runtime assumptions. | Core suites and browser fixtures run locally. The updated GitHub workflow and Docker/media jobs have not run in this session. |
| A16 | Medium | DB/full backup scripts use `umask 077`, private directories and root-only backup configuration/password-file checks. | Shell syntax passes; actual ownership/modes of old production backups remain unverified. Existing retained backups were not modified. |
| A17 | Medium | Read-only inventory/reconciliation includes Messenger attachments, message state, cleanup queues, direct pairs, reactions, unfinished transfers and temporary shares. File/folder share inventory follows the current FK path after rename. No token hashes/bodies are collected. | Synthetic tests distinguish intended cleanup, expired links, missing objects and active missing targets, and prove no fixture files change. Actual production reconciliation and wasted storage totals remain unverified. |
| A18 | Low | The storage handler allows an empty bucket root and preserves unrelated settings. | Settings API/DB tests and populated-prefix guard tests pass. |
| A19 | Low | `ExternalFileServerLink.tsx` exposes the configured external server separately in the signed-in sidebar, opening a safe new tab. The backend validates/normalizes HTTP(S) URLs and rejects embedded credentials. | Existing internal/public navigation suites pass. Verify the actual configured destination after rollout. |
| A20 | Low | Call engine/panel retain the active microphone/camera ID only after media acquisition/replacement succeeds; failed changes retain the prior selection. Cleanup clears IDs. | Media replacement/cleanup tests pass; actual PC microphone transmission still requires a physical-device call. No peer connection or TURN configuration was changed. |
| A21 | Low | Messenger mojibake separators/ellipsis are replaced with correct UTF-8 text. | Messenger selection and deletion browser suites pass. |
| A22 | Low | Expiry fixtures use a consistent transaction timestamp, previews use current semantic context-menu items, and Settings/Admin harnesses include required Messenger/call providers. Transfer fixtures exercise new receipts and wait for mutation completion. | SQL, preview, Settings, Admin and transfer regressions pass. |
| A23 | Low | Generated `dist/` is ignored and removed from Git tracking; local build artifacts remain. Docker also excludes audit output; shell entry points retain LF endings. | Fresh frontend build succeeds. Index removal is prepared; no commit/history rewrite occurred. The old public anon key is not being treated as a service secret. |
| A24 | Low | Current active admins can request private-video playback under the same server authorization used by the catalog. Admin role/session revocation is checked on every subsequent byte request. | Actual SQL tests accept an active admin with their own session and reject another user's session and role loss. |
| I01 | Informational | Existing output-routing feature detection/fallback is retained. Fixtures cover voice/video preferences, supported switches, headsets and unsupported APIs. | Physical earpiece/loudspeaker routes on iPhone/Android/Bluetooth remain unverified; no universal routing claim is made. |
| I02 | Informational | Existing live desktop functionality reported by the user and earlier confirmed two-way voice audio remain audit evidence. | Embedded-browser camera permission is not proof of a production camera defect. Real desktop/iPhone video, camera-off frames and device switching require a new coordinated live check after deployment. |

## Validation completed locally

- TypeScript: pass. ESLint: pass with **zero errors/warnings**.
- Production frontend build: pass. Existing large main/PDF chunks still produce
  the size advisory; no functional build warnings were hidden.
- Dependency scan: zero npm vulnerabilities.
- Fifteen core regression suites: actual security/config/playback SQL and Edge
  handlers, registration/approval/mail, Messenger permissions/deletion/calls,
  TURN credential handler, media engine, routing policy, sharing and ZIPs.
- UI fixtures: seven responsive call profiles from 1440×900 to 568×250; Firefox
  667×280 landscape; ten audio scenarios; eighteen people checks; twelve message
  deletion checks; fourteen context-menu checks; twenty-nine Settings checks;
  public navigation; six upload/integrity checks; twelve Admin settings checks;
  thirty-two preview groups across desktop/tablet/mobile/landscape and guest/private;
  eighteen auth/session checks; root/subdirectory share hosting; lazy-chunk failure; actual Caddy serving/policy checks.
- File-transfer SQL and browser tests at 1440 and 390 px include a full page reload,
  guarded Resume/Stop-tracking Cancel, Trash preservation, retry, ownership and
  uncertain-result safety. These use fixture catalog rows and in-memory bytes.
- Three read-only reconciliation tests and three email-dispatcher tests pass.
- Linux backup/deployment/startup shell syntax checked with Bash. No backup,
  service restart, migration, real email or production transfer was performed.

These are application fixtures, not a substitute for live Ubuntu services,
real concurrent PostgreSQL sessions, physical media devices, or proxy deployment.
Docker image validation and FFmpeg/LibreOffice container checks are gated in CI but
were not executable on this workstation.

## Call layout evidence

Fixture screenshots are in `.runtime/call-layout/` and contain synthetic video,
not real participants. In normal video mode, the remote video fills the main
canvas with a small mirrored self-view in the upper-right. Fullscreen contains
both views and bottom controls, with safe-area/short-landscape sizing. Voice mode
shows participant identity, status/duration and audio controls without black video
panels. Camera-off fixtures show an immediate black canvas; hiding self-view
retains camera transmission. Physical-device confirmation remains pending.

## Rollout order and material risks

1. **Recovery first:** verify and retain an off-host DB/content/config backup;
   inspect the current Auth session schema, Storage catalog version columns and
   PostgREST pre-request configuration. Rehearse the four new migrations on an
   isolated schema/data clone. An existing different pre-request hook deliberately
   blocks migration until its checks are composed, rather than overwritten.
2. **Security:** apply `20261012010000`, then deploy new account-login/Admin handlers,
   Auth configuration and frontend. The retired old issuer fails closed during
   cutover and remains disabled if old code is rolled back. Old setup codes become
   invalid; approved users request a new mailbox code. Verify Resend first.
3. **Integrity/functional:** apply `20261012020000` through `20261012040000`, refresh
   PostgREST schema/config, then deploy matching playback/transfer handlers and
   frontend together. New frontend transfer recovery fails closed against old DBs.
   Browser `<video>` requests use capability verification inside `serve-media`;
   ensure runtime gateway dispatch permits that public byte route as configured
   in `supabase/config.toml`, without bypassing handler checks.
4. **Hosting/reliability:** seed the running web assets before replacing the web
   container. Keep the asset-cache volume across upgrades. Verify missing chunks
   really return 404/no-store and HTML isn't cached immutably. Validate Caddy and
   merge the IIS header fragment into existing configuration; preserve current
   `/share/`, `/video/`, API and WebSocket routing. Redact capability query strings
   in proxy access logs. Actual public headers must be checked at the front door.
5. **Mail/backups:** start the bounded dispatcher with the existing media-worker
   image/private runtime environment. Review old failed deliveries outside the
   provider idempotency window manually. Activate the proposed backup timer only
   after a verified destination and first snapshot; rehearsal establishes RTO.
6. **Compatibility/UX:** use Node 22.12+ for the refreshed Vite toolchain. Tailwind 4
   targets modern browsers (Safari 16.4+, Chrome 111+, Firefox 128+); validate actual
   supported phones. Check portrait/landscape calls, input transmission, Bluetooth,
   fullscreen and camera-off/on with two dedicated accounts, then monitor errors.

Do not reverse the security migration to recover old activation behavior. Prefer
fixing forward. Neither transfer tracking nor full backups are atomic transactions
across PostgreSQL and Storage; uncertain outcomes remain explicit and require
review. Previously loaded/downloaded media cannot be withdrawn from a recipient.
No orphan cleanup, secret rotation, retained-snapshot pruning or production data
repair is included in this change.

Reference: [Tailwind upgrade guidance](https://tailwindcss.com/docs/upgrade-guide),
[Supabase session identity](https://supabase.com/docs/guides/auth/sessions),
[PostgREST configuration](https://docs.postgrest.org/en/stable/references/configuration.html).
