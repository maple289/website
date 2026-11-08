# UUID storage cutover: implementation notes

This is the pending compatibility design, not a deployed change. See
STORAGE_REORGANIZATION_AUDIT.md for completed operations and private evidence.

The user reconfirmed the target tree on 2026-11-07. Use immutable owner UUIDs,
video/photo UUID directories, and preserve existing file subfolders beneath
users/<owner>/files/. Public IDs and sharing remain database data. Sharing a
resource must never move/copy its bytes. Existing preview formats are preserved.

## Current implementation stage

- Full backups and isolated restore checks passed. Five proven redundant video
  originals were removed, with all other user content and permissions unchanged.
- Thirty private copies are verified. Two initially unpublished per-file-UUID
  copies were replaced by verified copies preserving the existing file hierarchy;
  only those two superseded unpublished copies were removed. No live file changed.
- Current copy manifest: verified-private-migration-manifest-v2.json in the
  private Windows backup directory. No application reference cutover occurred.
- The single-final worker and forward migration
  20261107010000_single_final_video_publication.sql were deployed on November 8
  UTC. Only the media worker was replaced; the other containers were unchanged.
  They retain legacy publisher compatibility, publish one video.mp4/thumbnail,
  preserve original probe metadata and retain ambiguous/failed staging inputs.
  Source-cleanup retries compare the exact final ID/version/update time recorded
  at Ready publication. Private drain control pauses claims/automatic cleanup.
- Seventeen isolated worker regressions and real isolated PostgreSQL publication,
  drain, cleanup and group-publication regressions passed. Full migration and
  selective rollback rehearsals against the restored live schema passed. The
  worker is healthy, claims resumed and existing content/shares were unchanged.
- The deployed decoder/dependency files match the checkout after normalizing
  Windows CRLF. Do not change FFmpeg policy or dependencies during worker rollout.
- Existing media conversion scratch is empty (4,096 allocated bytes); no unknown
  scratch content needs moving. Preserve isolation and existing cleanup locks.
- The second forward migration, 20261108010000_storage_location_compatibility.sql,
  and its serving/client changes are local preparation only. Isolated SQL checks
  cover exact legacy prefixes, current-location aliases, visibility/membership/
  session revocation, retained-object retirement, owner-scoped photo cleanup and
  metadata-bound file preview resolution. File catalog/transfer compatibility,
  new-layout publication, route compatibility and activation gates remain pending.
- Additional local forward migrations adapt the current file catalog and durable
  transfers, preserve canonical statistics while rebinding their actual Storage
  FK, add resource-specific users-bucket RLS and a service-aware write gate, and
  keep permanent file deletion retryable across active/retained locations.
  Restored-production-schema rehearsals preserve existing data and analytics.
  Rollback-only clone tests proved old-copy deletion keeps current metadata and
  counters, while current-copy deletion retains the intended cascades. Isolated
  catalog tests cover new uploads, favorites, moves, empty folders, permissions,
  write pauses, Trash validation, partial retry and path reuse. These changes
  are not deployed or activated; no new live storage references changed.

## Media locations

Add legacy-default bucket columns to videos/photos; do not change identities,
ownership, visibility, share rows or processing metadata. Video/photo paths stay
owner-relative database keys. Prefix settings apply only to legacy buckets.
Centralize trusted bucket/key resolution for serving, downloads, previews,
temporary shares and deletion. Only allow the exact known buckets/paths for the
authorized resource; never accept client-provided arbitrary buckets.

New video/photo publications must match their job's output layout and immutable
owner/media UUIDs. Retain old publication forms for existing jobs/clients during
upgrade. Preview replacement follows the target video's preview bucket, uses a
new upload UUID, and retains the existing confirmation/claim checks. Group-upload
grants must remain in the same publication transaction.

New user-facing image requests should use the existing resource-authorized
gateway rather than issuing non-revocable private Storage URLs. Public requests
must check current visibility; private/shared requests must recheck current
session and permissions. Preserve valid public thumbnail caching with conditional
ETag responses after authorization, rather than permanently caching failures.

## File catalog and operations

Keep virtual object_path values, metadata public_id, folder structure, Trash,
favorites, shares and durable transfer receipts. Add a legacy-default physical
bucket field and bind source_id to the verified new Storage object at cutover.
For users-bucket files, physical keys are owner/files/<relative virtual path>.

Provide an internal current-file catalog view that projects actual file objects
to existing owner-relative virtual names. Legacy aliases must be excluded once
retired, even after their current resource is deleted: otherwise deleted files
or folders could reappear from retained rollback objects.

Update the existing file catalog triggers/guards to support both layouts. API
copy/move must still commit metadata with the catalog. Do not permit deletion of
an old duplicate to cascade into metadata bound to its replacement. Empty folders
remain metadata; do not create sharing directories as a permission mechanism.

Adapt existing file-operation planning/checkpoints/receipts to the normalized
catalog while preserving source ID/version/update-time checks and ambiguous-copy
failures. The frontend should resolve source/destination buckets and keys before
Storage operations. Verify installed SDK/API support for cross-bucket copy/move.
Listing must merge current metadata folders and active catalog entries so retained
unknown legacy folder markers do not disappear silently.

Permanent deletion still runs only inside the existing confirmation's onConfirm.
Resolve all owned active/retained aliases and preserve partial-completion/retry
semantics. No new unguarded destructive helper caller is permitted.

## Retained aliases and statistics

Keep a private, server-managed migration registry containing old/new object IDs,
versions, bucket/keys, owner UUID, resource UUID, role and retirement state. It is
an authorization/audit mapping, not ownership inferred from disk. Retired aliases
must never become readable merely because their current metadata was deleted.
Record both legacy file folder markers (without new payloads) at cutover.

Storage IDs change during API copy. Preserve analytics identity/counters, not just
file public IDs. An internal canonical-ID projection for migrated files can keep
existing analytics IDs while preview jobs/metadata use actual new Storage IDs.
Ensure old duplicate deletion does not remove current analytics. Inspect actual
view/function definitions and all relevant foreign keys before choosing updates.

## Signed URL compatibility

The deployed frontend still uses Storage signing for images and some file
downloads. The local compatibility code uses revocable gateways instead.
Provider signed URLs remain valid until expiry/key revocation and do
not by themselves enforce changing resource permissions. Do not rotate global
Auth keys or delete old storage to hide this issue.

A resource-authorized compatibility gateway for the library signing routes may
be needed to preserve old clients while serving current public content and
revocable session-bound capabilities for private content. Limit routing changes
to library buckets; do not affect Messenger attachments or unrelated routes.
The installed Kong is 3.9.1 with the expressions router. Its isolated test passed
53 library/non-library/header-forgery cases. This router requires `~/` regex
paths and does not support look-around. Strip only the operation/bucket prefix;
keep object keys in the URI to preserve Unicode and percent escapes. The actual
Storage SDK signing response and live-permission gateway are tested locally.
Reject unsupported
batch/transform variants safely rather than allowing a provider-signing bypass.

Migration 20261108090000 prepares resource/session-bound hash-only grants.
Private grants expire within one hour and recheck current session and sharing on
every GET/HEAD. Public links recheck current visibility before ETag responses.
Previously issued provider JWTs grant no private access through the compatibility
route; private clients must mint a fresh authorized link. No global JWT rotation
or old-object deletion is used. The Kong fragment and handler are not deployed.
Use scripts/prepare-library-storage-gateway.py to produce a candidate template
without overwriting the original. Validate against the installed gateway, retain
the original configuration backup, and install only during the controlled
deployment. The helper preserves unrelated services and credentials byte-for-byte
and refuses an unreviewed replacement of an existing library route.

Primary references:
[Supabase downloads/signing](https://supabase.com/docs/guides/storage/serving/downloads),
[Kong Routes](https://developer.konghq.com/gateway/entities/route/),
[traditional routing](https://developer.konghq.com/gateway/routing/traditional/).

## Staging, cache and workers

Use staging/uploads/<owner>/<job>/ for future input objects and private worker
staging for conversions. Capture input bucket and output layout on queued jobs;
retry and cancellation must resolve those exact locations. A claim drain must
finish processing work before final cutover. Legacy inputs may remain readable
for existing jobs; new permanent outputs must use the new layout after activation.

Do not treat age-only or missing-job TUS receipts as abandoned. Installed file
store expiry is zero; all 18 unknown/receipt JSONs remain protected. New abandoned
input cleanup needs a provable reservation/lease/status and backend-safe deletion,
not a filesystem glob. Failed inputs remain available for recovery.

Library Office previews may use cache/previews/<owner>/<source>/<job>.pdf with
explicit cache bucket tracking. Preserve Messenger preview behavior in the shared
worker; update only library-location compatibility. Existing valid thumbnails
and previews must not be regenerated just because location changes.

## Activation and rollback gates

Rehearse forward/backward reference changes in the isolated restored database.
Deploy legacy-compatible code first. Drain claims and existing file transfers,
then control library writes while copying/verifying final deltas and creating a
fresh matching database/storage/configuration checkpoint. An RLS-only gate does
not stop service-role workers; use the explicit worker control and exact backend
mutation guards. Check in-flight resumable upload locks and source stability.

Switch media bucket/paths, file source IDs/buckets, alias retirement and output
layout transactionally from the verified manifest. Hold writes while testing.
If validation fails, restore old references/alias state from the same manifest
before allowing new writes. Later rollback requires reconciling post-cutover
user changes; never load an old dump over current writes blindly.

Verify owner/shared/group/anonymous access, revoked membership and saved URLs,
normal media use, file moves/copies/Trash, new normalization/no-conversion uploads,
failure recovery and source cleanup. Report actual browser/device coverage.
Keep old storage through successful observation. Final duplicate cleanup is a
separate later DB/new/old comparison; UNKNOWN data is never automatically removed.
