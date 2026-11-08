# Storage migration audit and verification

This repository contains the migration implementation and synthetic regression
fixtures. Live inventory, account identifiers, connection details, backup keys,
object manifests and deployment state belong in the private operator checkpoint.
They must not be committed to this public repository.

## Layout and authority

Permanent objects use the private users bucket with immutable owner/resource IDs:

    users/<owner-uuid>/videos/<video-uuid>/video.mp4
    users/<owner-uuid>/videos/<video-uuid>/thumbnail.webp
    users/<owner-uuid>/photos/<photo-uuid>/photo.<extension>
    users/<owner-uuid>/photos/<photo-uuid>/preview.webp
    users/<owner-uuid>/photos/<photo-uuid>/thumbnail.webp
    users/<owner-uuid>/files/<existing relative hierarchy>
    staging/uploads/<owner-uuid>/<job-uuid>/source
    cache/previews/<owner-uuid>/<source-uuid>/<job-uuid>.pdf

Supabase retains its required tenant/global-bucket/version wrappers. Operate
through Storage APIs, never by renaming provider directories. Conversion scratch
is service-private staging, not permanent user content. Visible folder hierarchy,
sharing, public IDs, Trash and favorites remain database-controlled. Deleting a
group removes its grants, not its members' owned media.

## Audit tools

scripts/audit-storage-layout.py and scripts/storage-layout-inventory.sql collect
read-only ownership/reference evidence. The dependency index under
audit/storage-reorganization-20261107 contains source paths and line references,
including historical SQL, frontend, endpoints, workers and operational tools.
Historical migrations are retained; forward migrations provide compatibility.

The original cleanup planner requires verified final video identity, positive
size, ffprobe validation, Ready status, current references, no retry dependency
and a verified backup. Sole-final MP4s are retained. Unknown originals and upload
receipts are review items, never extension/age-based deletion candidates.

The copy planner preserves file hierarchy and verifies immutable ownership and
resource identity. Copy first, compare sizes/hashes, probe videos and decode
images. Do not regenerate valid thumbnails solely because their location changes.

## Compatibility and security

Forward migrations add resource bucket fields, a private alias manifest,
metadata-bound file catalogs, stable analytics identities, resumable deletion
receipts, captured processing locations, scoped preview caches and revocable
storage-link compatibility. Public serving checks current resource visibility.
Private serving rechecks active user/session and current sharing. Retired copies
cannot revive deleted/private resources. No bucket is made globally public.

Manual saved-content deletions still run only through the existing shared
confirmation. Backend ownership/RLS remains independent. Partial failures retain
retry state and skip objects already removed. Failed/ambiguous video inputs stay
in staging; only proven successful single-final jobs qualify for source cleanup.

## Verification and cutover gates

Core tests execute real SQL in isolated PostgreSQL and actual Edge handlers with
mocked transport. Additional operator rehearsals use a network-isolated restore
with the installed Storage, PostgREST, Auth, Edge and decoder runtimes and fresh
test-only credentials. Tests cover new uploads, source cleanup/failure retention,
files moving/copying, Office cache generation/reuse, current public/private
authorization, link/session revocation, reference rollback and statistics.

Browser fixtures cover public previews, uploads, group destinations, preview
replacement, file operations, Trash confirmations and partial retries. Desktop
engines/mobile viewports are not evidence of physical Safari/iOS/Android tests.
Keep the device-specific results and remaining limitations in the private report.

Before live activation, verify matching full database/storage/configuration
backups, a restored database, a tested compatible application/worker release,
claim/write drain, idle acknowledgements and final source/destination hashes.
Switch references and alias retirement transactionally. Hold writes while
validating, and keep selective reference rollback available before resuming.

Retain old storage throughout the initial cutover and observation period. Final
cleanup is a separate database/new/old comparison. Unknown data is retained.
The private completion report records migrated counts, JSON classifications,
disk usage at each phase, errors and rollback status. See
STORAGE_LAYOUT_COMPATIBILITY_PLAN.md for implementation and activation details.
