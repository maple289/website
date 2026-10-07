# Content card actions

`ContentContextMenu` provides the circular vertical three-dot trigger and a
viewport-positioned portal menu for video, photo, file, folder and processing
cards. It supports keyboard navigation, touch targets, upward/sideways placement,
outside dismissal and closing after selection. Task dialogs retain the shared
modal safety rules. Menu capabilities come from ownership and the current scope;
the existing database and Storage authorization still decide every mutation.

Files/Folders alone have Move, Copy and Paste. Copy stores one owned item in a
memory-only, account-bound clipboard. Paste immediately starts copying to the
current folder; Move uses a paginated destination folder picker. The server plans
the entire payload/metadata tree and rejects unavailable sources, unowned or
missing destinations, Trash, invalid paths and self/descendant moves. Storage
uses its existing owner-only RLS and collision errors. Copies retain their source;
folder moves carry metadata/shares after the payload has moved.

Delete moves items to Trash by marking their existing catalog paths. If a later
transfer needs one of those names, the server plans preservation of that fully
trashed tree under a unique path first. Storage moves preserve its bytes and
identity; all Trash flags remain set and original names/locations are recorded.
The incoming item then occupies the freed path without an unnecessary conflict
prompt. Unknown or live destination contents still require an explicit choice.
Restore returns archived items to their original location and offers the normal
conflict choices when a current item occupies it. Completed preservation and
transfer steps stay in the task for retry. This also handles legacy Trash items;
it performs no bulk cleanup or permanent deletion.

Conflicts offer Replace, Keep both and Cancel. Keep both finds an available copy
name. Replace runs entirely within the existing deletion confirmation, preserves
the destination under a unique name and moves that previous file/folder tree to
Trash before placing the incoming item. Replacing the source itself or an
ancestor of the source is disabled. Existing grants on the preserved item follow
its metadata and become unavailable in Trash. No silent overwrite or new
unguarded delete helper is introduced.

Completed transfer and metadata steps remain in the mounted task for retry.
Replacement retry also retains its preservation plan after a cancelled error
confirmation. A lost Storage response can be uncertain: retries stop on a
collision rather than treating an unrelated destination as a completed copy.
Closing the task clears its retry plan. Recursive transfers use multiple Storage
calls, so they are not one distributed transaction; partial failures are shown
in the task/confirmation. Concurrent edits to the same tree should be avoided.

Folder downloads produce ZIP archives, including nested and empty folders, using
the same authorized/public read APIs. ZIP32 archives are limited to 65,535 entries
and less than 4 GiB; larger downloads fail explicitly instead of corrupting data.

# Temporary access

Owners can create/revoke a link through a TaskModal. Creating a replacement link
requires confirmation and the expected previous link ID, preventing concurrent
creation from silently replacing another active link. Tokens contain 32 random
Web Crypto bytes; only SHA-256 hashes reach PostgreSQL. Server timestamps set
expiration to precisely creation plus 24 hours. Neither operation changes normal
visibility or sharing grants.

`<frontend-base>/share/<token>` renders a standalone visitor page outside the authenticated app
shell. The `temporary-share` function checks the capability, expiration, current
content record and Trash/ancestor state on each metadata or byte/range request.
It proxies content without exposing reusable signed Storage URLs or owner/profile
details. Folder capabilities list only their own subtree with relative names and
bounded pagination; they never grant normal folder browsing or metadata access.
Invalid/deleted/revoked links return “This share link is no longer available.”;
expired links return “This share link has expired.” Browser/cache headers prohibit
caching. Already received/downloaded bytes cannot be recalled.

Links follow moved file metadata; deletion cascades remove their capability rows.
Revocation and replacement invalidate access immediately for subsequent requests.
Revoked/expired hashes are retained until content deletion to distinguish the
visitor messages; no periodic cleanup is needed to enforce expiration.

# Deployment and verification

Apply `supabase/migrations/20261007010000_content_context_actions.sql` through the
existing migration workflow before releasing this frontend. Deploy the new
`temporary-share` Edge Function **with JWT verification disabled** (configured in
`supabase/config.toml`); its POST handler validates the user session independently.
It requires the existing server-only Supabase URL, anonymous key and service-role
key. For self-hosted deployments, synchronize functions, configure anonymous
GET/HEAD access for this function and restart the functions service. The existing
Caddy SPA fallback serves the share route; the public function must remain reachable
for native image/video/range/download requests without a login session. No
production migration, function deployment or frontend release was performed by
this implementation task.

Also apply `supabase/migrations/20261007020000_reuse_trashed_file_names.sql` before
the updated frontend. It adds original Trash paths and owner-authorized transfer
and restore planning. Existing Trash payloads are preserved lazily when their
names are reused; no existing user files are mutated by the migration.

Link creation and visitor routing both honor Vite's `VITE_BASE_PATH`. For the IIS
deployment at `/video/`, generated URLs are `/video/share/<token>`; root hosting
uses `/share/<token>`. The API remains at the configured Supabase URL. Existing
tokens do not need regeneration: after deploying the corrected frontend, insert
`/video` before `/share` in previously generated URLs for this deployment.

Checks: TypeScript, changed-file ESLint, production build, isolated desktop/mobile
browser fixtures (`tests/content-context.mjs`), in-memory PostgreSQL including
the existing catalog triggers (`tests/content-context-db.mjs`), the actual Edge
handler with mocked Storage (`tests/temporary-share-server.mjs`), and standard
ZIP-reader verification (`tests/folder-downloads.mjs`). PostgreSQL fixtures model
the required existing tables; they are not a full self-hosted Supabase replay.
The existing upload-card deletion regression also passes at 1440/768/375 px,
and `tests/temporary-share-page.mjs` checks the standalone mobile visitor page.
`tests/temporary-share-routing.mjs` checks root and subdirectory share routing.
`tests/temporary-share-hosting.mjs` creates a link through the owner dialog and
opens it through the real App entrypoint under both `/` and `/video/`, checking
that visitors cannot reach the normal app shell or endpoints.
`tests/file-trash.mjs` exercises real PostgreSQL plans/catalog triggers with the
desktop/mobile File Manager: copy/paste/delete/paste, preservation retries,
restore conflicts and confirmed permanent deletion of complete folder trees.

Browser fixtures use local Vite plus mocked APIs; they never modify real users or
payloads. Set `PLAYWRIGHT_MODULE`, `TEST_BASE_URL`, `PGLITE_MODULE` and `PYTHON_BIN`
to the available local runtimes as needed. PGlite is an isolated test dependency,
not a production application dependency.
