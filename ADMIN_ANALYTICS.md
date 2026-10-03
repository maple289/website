# Admin Statistics

Open **Admin Console → Statistics**. The existing User Accounts and File Locations
controls remain available. Statistics has Overview, Users, Videos, Photos, Files,
Storage and Activity sections. It does not create replacement Email/Settings
administration screens or a deletion-history interface.

## Definitions

- Email remains the unique username/login identifier. Tables additionally show
  the current profile name, account state and role in user details.
- Active users: enabled accounts with login or website interaction within 30 days.
  A visible signed-in session sends an activity touch at most once per five minutes.
- Video views: first `playing` event of an opened player, not metadata/card loading,
  autoplay previews in the editor, conversion or thumbnail generation.
- Photo views: opening/navigating the full Photo Viewer; adjacent preloads do not count.
- Files: successful explicit previews and downloads are separate. Gallery thumbnails,
  generated Office PDFs, preview polling and background downloads are excluded.
- Only registered user IDs contribute to unique viewers. Guests contribute totals
  without fingerprints, persistent visitor IDs or IP-based identification.
- Each viewer opening uses an idempotency nonce. Registered repeat views of the
  same item/action within 30 seconds are suppressed. Direct storage access outside
  the website viewer is not presented as known playback. Client reporting is best
  effort; blocked/offline requests can make counts lower than actual usage.
- Uploads are current, successful content. Media completion is recorded after the
  background worker finishes; failed/staging/retry jobs are excluded. File uploads
  are confirmed against an existing owned storage object after metadata saves.
  Copy actions do not submit upload events. Historical current files use their
  existing creation timestamps; old copies cannot be identified retrospectively.
- Week starts Monday. Ranges use the administrator's browser timezone; custom
  ranges are limited to 366 days. Content tables default to all current content
  and can optionally filter uploads to the selected date range.

## Backend and permissions

`admin_analytics` checks the current authenticated, enabled administrator account
on **every** request, including cache reads. All analytics tables/views are private;
normal users and guests cannot read statistics directly. The tracking RPC derives
the actor from `auth.uid()` and rechecks original public/owner/shared permissions.
Guest Files events resolve an opaque public ID through the existing Everyone
resolver, without returning storage keys or protected parent names.

`analytics_content` uses cascading foreign keys to the current video, photo or
Storage object. Its events/viewers/activity disappear when that source is permanently
removed. User-related activity also references current accounts. No soft delete,
deleted status/date, deletion counter or deletion history has been introduced.
Existing Trash still exists; it is excluded from current file counts but remains
physical storage. Source removal invalidates cached aggregate results immediately.

Source/upload/activity triggers catch and log their own analytics errors by SQLSTATE
without interrupting an otherwise successful upload, login or account change.
Administrative API updates record their verified caller through a service-only
RPC. No password, token, storage path or full request body is logged by analytics.
Sharing still uses its existing authorized atomic RPC and confirmation UI; unchanged
grants are preserved so a no-op Save does not produce artificial share/unshare events.

## Performance and storage

- Tables and owner selection use 25-row server pagination; queries use bounded,
  whitelisted sorting and parameterized search. Search is debounced and stale
  frontend requests aborted. Charts load separately from table pages.
- Aggregate dashboards cache for 30 seconds; time, owner and content indices support
  aggregation. Statistics code loads only when the Admin Statistics tab opens.
- `analytics-collector` refreshes disk/storage inventory every ten minutes (minimum
  five via `ANALYTICS_STORAGE_INTERVAL`). The website does **not** recursively scan
  storage per request. Its container has read-only storage/scratch mounts, no Docker
  socket, dropped capabilities, and CPU/memory/process limits.
- Actual filesystem capacity/used/available come from the OS. Shared filesystems are
  deduplicated by device. Bucket payload sizes include originals, processed MP4s,
  thumbnails, cached previews and conversion/staging files; database allocation is
  included in Other application data. LibreOffice memory-backed scratch is not disk.
- Disk used also includes the OS, Docker layers, backups and other filesystem data.
  Consequently application payload totals need not equal total filesystem usage.
  Payload sizes are logical bytes, not compressed/block allocation measurements.
- User storage aggregates current Storage object size metadata, including retained
  versions and previews in the relevant category. Physical inventory also accounts
  for unindexed retained payloads without assigning them to removed accounts.
- Configured video/photo prefixes are storage keys inside the existing mounted
  Supabase buckets. External file-server contents are not assumed local or scanned;
  analytics cover the website's existing Files bucket. Inaccessible measurements
  are reported as incomplete; capacity is never fabricated from database totals.

Deploy normally with `scripts/deploy.sh`: builds the collector, applies both analytics
migrations, synchronizes the administrative API and starts the collector before the
frontend. Secrets remain in the existing runtime environment, never in frontend code.

## Validation scope

After the interrupted work, verification found and corrected an ambiguous upload
trigger column reference, custom date-input event handling, and an inventory-scan
race with concurrent file deletion. Owner-name searches and historical upload
completion checks were also tightened. Overdue storage snapshots show a warning.

- Both migrations compiled and 73 database assertions passed in disposable fixture
  databases on the existing PostgreSQL server. Tests covered all Statistics APIs,
  sorting/pagination, protected content, ordinary-user/guest denial, disabled and
  password-required administrators, nonce deduplication, successful/failed uploads,
  public folder inheritance, Trash, storage attribution and cascading cleanup.
  Each fixture database was removed; the production database was not changed.
- Five isolated collector tests passed: category/user accounting, shared-filesystem
  deduplication, disappearing entries, inaccessible entries, keyset paging and
  invalid root rejection. Run `python services/analytics-collector/test_collector.py`
  from the project directory; network calls are mocked.
- The actual React Statistics component was checked against a local synthetic API
  at desktop (1440 px), tablet (768 px), mobile (390 px) and small mobile (320 px)
  widths. Pagination, user details, empty search, custom ranges, table scrolling,
  chart stacking and 44 px controls were checked. No physical devices were used.
- TypeScript, targeted ESLint and the production build passed. The wider lint check
  retains the existing AuthContext fast-refresh warning; existing large application
  and PDF bundle warnings remain.

## Live deployment

Deployed on October 3, 2026 following explicit authorization to deploy Statistics.
Both analytics migrations are installed, the administrative API is synchronized,
and the collector and frontend containers are healthy. The public site at
`https://myhostage.ca/video/` serves the new frontend bundle and Statistics assets.
All eight live analytics API sections passed under an existing administrator's
identity in a rolled-back transaction. An anonymous HTTP request was denied with
HTTP 401 / SQLSTATE 42501. The collector completed a real filesystem inventory
with no incomplete locations. No test accounts or artificial content events were
created in production. The live Admin UI requires an administrator sign-in;
interactive responsive checks used the local synthetic API described above.

The original database/source backup is retained at
`/srv/streamly/backups/analytics-20261003-074659`. The idempotent deployment retry
also has a backup at `/srv/streamly/backups/analytics-20261003-074926`. A local log
encoding issue interrupted the first frontend build; it was corrected before the
second deployment completed. The existing site remained available throughout.

This was a direct deployment of reviewed working-tree changes. These changes are
not yet committed or pushed to GitHub; commit/push is still needed to preserve the
feature in the repository and its automatic deployment workflow.
