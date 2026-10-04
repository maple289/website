# Admin System Load

The Admin Console has a **System Load** navigation item and a compact live sidebar widget. Both share one request loop. The larger view remains accessible through the navigation menu on tablets and phones.

## Measurements

- Overall and per-logical-CPU utilization come from changes in Ubuntu's `/proc/stat` counters over approximately three seconds. CPU IDs/count are rediscovered for every sample. Newly online/reset CPUs display a sampling indicator until a second reading is available. There is no hard-coded CPU count.
- Idle and I/O wait are excluded from busy time. Guest counters are not counted twice. Overall utilization weights the measured CPU deltas, rather than simply rounding/averaging displayed percentages.
- RAM is `MemTotal - MemAvailable` from Ubuntu's `/proc/meminfo`, with a fallback for kernels without MemAvailable. Reclaimable cache is available memory. Sizes are displayed in GiB; the total is Ubuntu's reported usable RAM, not an assumed VM allocation or the collector's container limit.
- **Converting** counts current `processing` video jobs, including their validation/download/conversion stages. **Queued** counts queued video jobs. Photo and saved-preview jobs are excluded. CPU/RAM measure the whole VM, not just FFmpeg.

References: [Linux proc counters](https://www.kernel.org/doc/html/latest/filesystems/proc.html) and [CPU accounting fields](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.11/man/man5/proc_stat.5).

## Architecture and security

The existing analytics collector has an independent sampling thread, so periodic storage inventory does not set the refresh interval. Only `/proc/stat` and `/proc/meminfo` are mounted read-only; no Docker socket, host process/environment files or broad host filesystem access is added.

Migration `20261004160000_admin_system_load.sql` adds a private singleton `analytics_system_load` snapshot and two RPC functions. Only the backend service role can call `analytics_store_system_load`. The frontend calls `admin_system_load`, which verifies the authenticated administrator role, active account and completed password setup. Direct snapshot-table access is revoked, RLS is enabled, and normal user statistics stay unchanged. The RPC accepts no user ID or caller-selected scope.

A partial index covers queued/processing video jobs for inexpensive counts. Only the latest system reading is stored; this feature creates no monitoring history. Monitoring does not traverse storage, change content, launch conversion jobs or alter video-processing settings.

## Refresh and failure handling

Backend samples and frontend polling normally refresh every three seconds. Polls are sequential and stop when the browser tab is hidden, the widget is not visible on mobile, the administrator leaves the console, or access is denied. Opening the mobile System Load section resumes the same shared polling loop; the sidebar and larger view do not duplicate requests. Requests are aborted on cleanup and have a timeout.

No sample is represented as zero load. Missing readings show a waiting state; failed/stale readings are clearly labeled as delayed. The backend marks snapshots older than 15 seconds as stale. The collector health check includes its monitoring heartbeat. Diagnostic logs contain the operation, error category/status and detected CPU count; request headers and secrets are excluded.

## Deployment

Build the analytics collector and frontend with the existing Compose/deployment architecture, apply the additive migration, and recreate only the collector and frontend. The migration notifies PostgREST to reload its schema. Video workers do not need to restart.

Before production migration, retain a private custom-format PostgreSQL backup and verify its archive listing. Restore a backup first to an isolated database using `pg_restore`; restoring production requires stopping writes and rolls back later data changes. Source/image snapshots permit an application rollback without deleting the new snapshot table or altering existing content.

Deployed on 2026-10-04 UTC. Live read-only diagnostics returned eight CPU rows, a 3.0-second sample interval and a fresh snapshot. The collector, website and unchanged video worker were healthy. The HTTPS frontend serves the new widget/RPC code. Snapshot RLS is enabled; authenticated users cannot read the table directly, and anonymous users cannot execute the Admin RPC. Existing content counts and video storage references matched the pre-deployment snapshot.

A private backup is retained at `/srv/streamly/audits/system-load-20261004/pre-system-load.postgres.dump`; its archive listing was verified. That directory also contains the source snapshot, deployment log, latest diagnostic RPC reading and verification summary. Repository changes are not committed/pushed yet.

TypeScript, targeted ESLint, Python compilation and whitespace checks passed. Validation also included read-only live diagnostics. No automated workflow tests or physical-device interaction tests were added/run for this request.
