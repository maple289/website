# Video deletion

## Root cause

The old client deleted video storage objects and the `videos` row but left the
matching `media_upload_jobs` row. `VideoProcessingJobs` rendered completed jobs
absent from the gallery as separate Ready placeholders. This made a successful
video deletion look incomplete and survived page reloads.

## Changes

- Completed jobs refresh the gallery but do not render placeholder cards.
- Both video cards and pending upload cards use the existing delete confirmation.
- `delete-video` verifies the session and binds the owner to that session. Disabled
  accounts and accounts requiring initial password setup cannot start deletion.
- A private deletion tombstone blocks publication and new preview jobs for the ID.
- Running jobs acknowledge cancellation only after their decoder process group
  and local temporary files have been released. Pending cleanup remains retryable.
- The endpoint resolves actual Storage catalog keys, including configured/older
  base directories, deletes original/processed media, previews and staged uploads
  through the Storage API, and verifies cleanup before deleting database records.
- A storage error retains the media record and reports incomplete deletion.
- The migration reconciles old completed jobs with missing videos. Jobs with
  remaining stored objects become retryable cleanup cards; empty jobs are removed.

## Deployment

Deploy the migration, `delete-video` function, rebuilt worker and frontend together
using the existing deployment pipeline. Do not deploy only the frontend: direct
authenticated video-row deletion is replaced by the server cleanup operation.

## Checks performed during development

- TypeScript and targeted frontend ESLint passed.
- Worker regressions cover publication, ambiguous API failures and cancellation.
- `node tests/video-deletion.mjs` checks the endpoint with mocked storage/auth:
  anonymous/other-owner rejection, running-job wait, storage failure and success.
- `tests/video-deletion.sql` exercised the migration and lifecycle in a rolled-back
  server transaction: owner checks, cancellation acknowledgement, blocked late
  completion, persistent tombstones and idempotent retry.
- Production inspection found a completed orphan job with no remaining media
  payloads, but with a small TUS upload-receipt JSON. The receipt cleaner now uses
  completed deletion tombstones to remove these receipts after verifying that
  their payloads are absent. See `VIDEO_TROUBLESHOOTING.md` for live checks.

Only dedicated temporary regression uploads were deleted in the live browser
checks. A crashed worker may leave cancellation pending; do not
force-complete such deletion until the old decoder is confirmed stopped.
