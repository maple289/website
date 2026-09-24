# File and folder sharing

Apply all migrations through `supabase/migrations/20260924010000_add_public_files.sql` using the project's migration workflow **before deploying the updated frontend**. Deploy the `serve-public-file` Edge Function with JWT verification disabled (configured in `supabase/config.toml`). It uses the standard server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; never put the service key in a Vite variable. For self-hosted deployments, run the existing `scripts/sync-functions.sh` workflow and restart the functions service. The frontend, migration, and function must be deployed together. These changes have not been applied to the hosted database or server by this development task.

**Visibility change:** existing and future Everyone grants now include anonymous visitors. Review existing Everyone grants before deployment; remove grants that should remain limited to selected users.

The item action menu contains Share for owners. The dialog stages changes until Save sharing; closing or Cancel discards them. Everyone requires confirmation and means anyone, including anonymous visitors. Recipients have read/download access only. Existing owner-only storage and metadata write policies continue to enforce edit, rename, move, upload, and delete restrictions on the server. The user picker exposes only registered users' IDs and emails, only to an owner managing an existing item, with a two-character minimum and 20 results per query.

Folder grants apply to current and future descendants. Matching uses literal slash-delimited prefixes, so similarly named siblings and `%`/`_` in names cannot broaden access. A child can also have direct grants. Removing a child's direct grant does not override an inherited parent grant; the dialog identifies each parent whose sharing must be changed. Everyone can likewise remain inherited after disabling a direct Everyone grant.

Direct grants follow metadata renames/moves through a cascading foreign key. Moving an item out of a shared folder removes that folder's inherited access; moving into a shared folder adds the destination's inherited access. Copies start without direct grants and inherit their destination folder's access. Trashed items and descendants of trashed folders are hidden from recipients; restoring them reactivates their grants. Deleting metadata removes its direct grants.

Signed-in users see their own root items and shared roots together in All files, with separate load-more controls. The existing Shared section also provides shared items in 50-item pages. Search uses the same metadata RLS as browsing and includes accessible shared items. Indicators distinguish individual-user and Everyone access (including inherited access). The Shared section and search use registered file metadata, as the existing search did.

File Manager previews and thumbnails now use authenticated Storage downloads with local blob URLs, instead of generating transferable signed URLs. Each new download checks storage RLS; revocation cannot retract bytes that were already downloaded. Previewing a large video now downloads it before playback, so it may be slower and consume more browser memory. Existing signed URLs issued before deployment remain valid until their original expiry.

## Public access

The Home navigation and Files page show Videos, Photos, and Files. `#/files` works without signing in. Both scopes use FileManager, FileTree, the same cards, selection, preview, search debounce, and pagination. Guests see a public-content label and read-only menus, with no upload, create, sharing, or other management controls. Changing identity remounts the manager to discard the previous identity's cached results.

`list_public_user_files` is the only anonymous metadata entry point. It checks Everyone grants and trash state on the server, limits responses to 51 rows (50 plus a lookahead), and returns opaque item IDs, public names, and paths relative to the first public ancestor. Ancestors above a public grant, owner IDs, user emails, favorites, and storage keys are not returned. Search covers public descendants globally; tree search reveals only public ancestors. Expanding a folder fetches just its next child page. Filename search reuses the metadata name/trigram architecture, and child/ancestor lookups have indexes.

The bucket stays private. Anonymous users have no raw metadata, share-table, or Storage access. The byte proxy accepts only an opaque ID, calls a service-only resolver which rechecks the current Everyone grant and trash state, and streams bytes without redirects, signed links, upstream headers, or storage paths. Private and missing IDs return the same generic 404. Only GET/OPTIONS are accepted; anonymous mutation permissions are unchanged. Public file downloads use no-store responses and local blob previews; large previews still download into browser memory. As with authenticated downloads, revocation cannot retract bytes already received.

The local regression script below covers the original authenticated sharing migration. It does not validate the new public migration or Edge Function. Deployment checks should include nested public shares under private parents, private/specific-user-only shares, guessed IDs and storage paths, no results, pagination, revocation/trash, both user identities, and guest mutation attempts.

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
