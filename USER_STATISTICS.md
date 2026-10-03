# Personal Statistics

Authenticated users can open **Account menu → Statistics** or the Statistics
sidebar entry. The existing hash router uses `#/statistics`; browser Back/Forward
and public Videos/Photos/Files navigation retain their existing behavior.
The page loads separately and remounts when the signed-in account changes.

## Scope and permissions

`public.user_analytics` is the personal counterpart to `admin_analytics`. It reuses
the existing content registry, upload timestamps, view/download events and reaction
counts. It accepts no user ID or owner filter. Every request derives identity from
`auth.uid()` and checks that the account exists, is enabled and has completed
password setup before reading either live data or its private cache.

Only `overview`, `videos`, `photos` and `files` sections are accepted. All queries
are restricted to the current owner. The private personal catalog also checks the
source record's current ownership. Existing authorized ownership changes update
the derived registry and invalidate aggregate caches transactionally. Existing
source-deletion and Trash cache invalidation continue to apply.

Responses use explicit field lists. They contain no other user identities, viewer
names, account totals, admin activity, logs, storage paths, physical disk metrics,
storage configuration, preview-cache sizes or processing-space measurements.
The underlying analytics tables and private views remain inaccessible directly to
ordinary users and guests. Administrator permissions and the administrator API
remain unchanged. Even administrators see only their own content on this page.

## Metrics and presentation

- Compact cards show owned video/photo/file counts, video/photo views, file preview
  and download counts, personal storage, successful uploads this month and received
  reactions.
- Videos and photos have searchable, sortable 25-row tables with upload dates,
  sizes, visibility/sharing, views, reactions and last-viewed timestamps. Video
  duration and processing state are included.
- Files include type/extension, size, visibility/sharing, previews, downloads and
  last access. Type filters reuse existing MIME-aware file classification.
- Shared charts/tables provide uploads and views history, personal storage and
  file-type distributions, most viewed/accessed content and most reacted media.
  Numeric values remain available alongside every chart.
- History ranges are Last 7 days, Last 30 days, This month and Custom range (maximum
  366 days), using the browser's timezone. Totals/top charts cover current content
  across all dates; tables may optionally filter upload dates to the chosen range.
- File history includes previews **and** downloads. Successful-upload definitions
  come from the existing completed-upload tracking. Failed processing records can
  appear as current content but do not count as successful uploads.
- Storage measures current owned payloads from existing Storage object metadata:
  retained video originals/playable files, original photos, and current Files.
  Duplicate video paths are counted once. Thumbnails, generated preview caches,
  processing/staging files and existing Trash are excluded. These are content bytes,
  not physical disk allocation or a server/user quota.

The responsive page uses the existing Fluent design, stacked charts on narrow
screens, touch-sized controls and independently scrollable tables. Search is
debounced, stale requests are aborted and owner-scoped summaries cache for 30
seconds. No filesystem scans or additional collectors/counters are introduced.

## Installation

Deploy the frontend together with
`supabase/migrations/20261003000000_user_analytics.sql`. The normal
`scripts/deploy.sh` workflow applies the migration before rebuilding the frontend.
No new environment variable or service is required. This change has not yet been
deployed to the live server. TypeScript, targeted lint and the production bundle
compile successfully; database execution and interactive device behavior have not
been exercised for this addition.
