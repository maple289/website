# File and folder sharing

Apply `supabase/migrations/20260924000000_add_file_sharing.sql` using the project's migration workflow **before deploying the updated frontend**. No new environment variables or Edge Functions are needed. This change has not been applied to the hosted database by the development task.

The item action menu contains Share for owners. The dialog stages changes until Save sharing; closing or Cancel discards them. Everyone requires confirmation and means all authenticated users, never anonymous visitors. Recipients have read/download access only. Existing owner-only storage and metadata write policies continue to enforce edit, rename, move, upload, and delete restrictions on the server. The user picker exposes only registered users' IDs and emails, only to an owner managing an existing item, with a two-character minimum and 20 results per query.

Folder grants apply to current and future descendants. Matching uses literal slash-delimited prefixes, so similarly named siblings and `%`/`_` in names cannot broaden access. A child can also have direct grants. Removing a child's direct grant does not override an inherited parent grant; the dialog identifies each parent whose sharing must be changed. Everyone can likewise remain inherited after disabling a direct Everyone grant.

Direct grants follow metadata renames/moves through a cascading foreign key. Moving an item out of a shared folder removes that folder's inherited access; moving into a shared folder adds the destination's inherited access. Copies start without direct grants and inherit their destination folder's access. Trashed items and descendants of trashed folders are hidden from recipients; restoring them reactivates their grants. Deleting metadata removes its direct grants.

Recipients use the existing Shared section, with 50-item pages. Search uses the same metadata RLS as browsing and includes accessible shared items. Indicators distinguish individual-user and Everyone access (including inherited access). The Shared section and search use registered file metadata, as the existing search did.

File Manager previews and thumbnails now use authenticated Storage downloads with local blob URLs, instead of generating transferable signed URLs. Each new download checks storage RLS; revocation cannot retract bytes that were already downloaded. Previewing a large video now downloads it before playback, so it may be slower and consume more browser memory. Existing signed URLs issued before deployment remain valid until their original expiry.

## Local database regression checks

The test harness runs real PostgreSQL via PGlite against minimal auth/storage fixtures plus the actual File Manager migrations. It never connects to a live Supabase project. It checks three authenticated identities and an anonymous role, mutations, inheritance, revocation, path boundaries, grant lifecycle, searching, and pagination. Supabase's hosted Storage HTTP implementation and real authenticated browser sessions still require deployment smoke testing.

Install the test-only runtime in the ignored `.runtime` directory, then run:

```sh
mkdir -p .runtime/sharing-tests
echo '{"private":true,"type":"module"}' > .runtime/sharing-tests/package.json
npm install --prefix .runtime/sharing-tests --ignore-scripts @electric-sql/pglite@0.5.8
node scripts/test-file-sharing.mjs
```

Also run `npm run typecheck`, lint the changed components, and `npm run build -- --outDir .runtime/sharing-build` to avoid rewriting tracked deployment artifacts.
