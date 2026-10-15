# Admin statistics baseline

Apply `supabase/migrations/20261015010000_admin_statistics_reset.sql` with the
normal database migrations before deploying the frontend. No new environment
variables or edge-function deployment is required.

`analytics_config.statistics_reset_at` is a nullable server timestamp. Before
the first reset, existing lifetime reports are retained and Statistics since
shows `tracking_started_at`. Afterwards the admin reports count events at or
after the reset, intersected with the selected chart/activity date range.

The POST RPC `admin_reset_statistics()` requires `auth.uid()`, database admin
role and an active, non-banned, non-deleted account with completed password setup.
The existing Supabase client supplies a bearer JWT; ambient cookies do not
authorize this action, so no cookie-based CSRF token is involved. Anonymous
execution and direct client writes to the private configuration are denied.

The function locks the singleton configuration, changes its timestamp, and adds
`statistics_reset` with actor ID/time to the existing private activity log in one
transaction. Audit failure rolls back the baseline. Dashboard reads share the
configuration lock; cache keys contain the baseline, so old summaries cannot
populate the reset window. Reset audit entries are excluded from displayed
activity and do not manufacture activity/user counters.

Admin counters, top-content rankings, registered viewers, access times, upload
charts/counters and per-user drilldowns use private baseline projections.
Current content counts, storage, actual reactions and account metadata stay
unchanged. Lifetime counters, raw events, historical activity and all application
content remain intact. Personal statistics retain their existing lifetime scope.
The existing summary cache can delay subsequent views by up to 30 seconds;
reset itself always uses a fresh cache window.

The single UI action in AdminStatistics uses the existing confirmation provider,
explicit Cancel/Reset All, focus/inert/scroll protection and a synchronous guard.
Only successful reset invalidates frontend requests, updates the visible baseline,
reloads both dashboard/table data and shows a brief success notice. Failure keeps
reports unchanged and displays the error in the confirmation.

Regression checks:

- `node tests/admin-statistics-reset-db.mjs`: real analytics migrations and RPCs
  in isolated PGlite, role/account checks, rollback, retained records, repeated
  resets, cache separation and events exactly on/after the baseline.
- `node scripts/run-ui-regressions.mjs admin-statistics-reset-ui`: actual admin
  components with isolated API fixtures at desktop, tablet and phone widths;
  confirmation/Cancel/error/retry, pending and duplicate guards, stale responses,
  both sections, timestamps, new events, role visibility and no page reload.

Both suites are included in the existing core/browser CI runners. Browser fixtures
test the frontend contract; PostgreSQL tests exercise the real authorization and
transaction logic. Neither suite connects to production or resets live statistics.

## Changed files

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261015010000_admin_statistics_reset.sql` | Baseline column, reset RPC, audit action and scoped admin queries |
| `src/components/AdminStatistics.tsx` | Button, confirmation, timestamp, success notice and request invalidation |
| `src/lib/analytics.ts` | Typed reset RPC client and baseline response field |
| `src/components/AdminStatistics.css` | Responsive header/button styling |
| `src/components/AdminConsole.css` | Existing console theme for grouped header controls |
| `tests/admin-statistics-reset-db.mjs` | Isolated PostgreSQL authorization/data/rollback regression |
| `tests/admin-statistics-reset-ui.mjs` | Browser regression at three viewport widths |
| `tests/admin-statistics-reset-harness.tsx` | Actual AdminPage with fixture authentication/providers |
| `tests/admin-statistics-reset.html` | Isolated browser fixture entry |
| `scripts/run-core-regressions.mjs` | Includes the database regression in core CI |
| `scripts/run-ui-regressions.mjs` | Includes the browser regression in UI CI |
| `DELETE_SAFETY.md`, `MODAL_SAFETY.md` | Shared-confirmation safety inventory |
| `ADMIN_STATISTICS_RESET.md` | Implementation, deployment and verification notes |

Verified locally: 9 PostgreSQL checks and 45 browser checks (15 each in Chromium,
WebKit and Firefox), TypeScript, repository lint and the production build passed.
All core regression suites passed; the folder ZIP check required the bundled
Python executable because the Windows `python` alias was unavailable.
