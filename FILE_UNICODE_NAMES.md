# Russian and other Unicode File Storage names

The Storage object API rejects raw Cyrillic keys. Renaming a PDF to a Russian
name used the visible name as the physical key, producing `Invalid key`.
The durable transfer correctly retained its unfinished receipt, so starting a new
rename to that destination then produced the unfinished-transfer warning.

Migration `20261118010000_unicode_file_names.sql` fixes the physical-key mapping
without changing visible filenames or saved virtual paths:

- Supported ASCII paths keep `users/<owner>/files/<original path>`.
- Paths containing unsupported characters use
  `users/<owner>/files-utf8/<hex UTF-8 segment>/<hex UTF-8 segment>...`.
- Segments are encoded independently and decoded only in this separate namespace.
  Names are not transliterated, normalized, or merged. Existing keys are not moved.
  The resolver retains existing catalog-bound locations when present.
- Storage writes, catalog synchronization, reads, sharing, previews, statistics,
  and pending-deletion checks use the same physical/virtual mapping. Metadata and
  sharing retain the original Russian name. Encoded folder markers remain folders.
- Ownership, active-account checks, RLS, maintenance gates, source-version checks,
  uncertain-copy protection, and confirmations remain in force. Encoded traversal,
  malformed UTF-8 and noncanonical aliases are rejected. Overlong physical keys
  receive an explicit name/path-length error.

This targets the active layout-2 `users` file namespace. Legacy keys remain
readable and are not rewritten. The migration does not cancel tracking, delete
files, or execute pending transfers.

## Deployment and recovery

Apply the new database migration through the normal deployment process. No
frontend or Storage image update is required. This repository change alone does
not update a running site's database.

After deployment, cancel the failed confirmation, select the existing entry's
**Resume** under **Unfinished transfers**, and confirm. Its saved destination is
still the Russian virtual filename; the resolver now returns a storage-safe key.
Completed steps retain their existing identity checks. Do not discard the receipt
or re-upload the document just to recover this failed rename.

## Validation

`tests/unicode-file-names.mjs` reproduces the old resolver's invalid key, applies
the migration over the already-started receipt, and completes that same rename.
It checks the exact reported Russian filename, nested Russian folder/file copies,
ASCII compatibility, other scripts/emoji, malformed encodings, public/object
identity, sharing, analytics, preview sources, owner isolation, deletion locks,
and maintenance. The existing storage-link regression now follows a saved link
through a Russian rename and verifies subsequent revocation. The preview-cache
regression queues a Russian Office filename and invalidates its preview on Trash.
All tests use synthetic records in isolated PostgreSQL, not the live site.
