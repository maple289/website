# Messenger groups and private library sharing

Group creation and member management extend the existing Messenger RPCs and UI.
No changes to video players, PiP/fullscreen, WebRTC signaling, TURN or network
configuration are required. Library videos/photos are references, never copied
into Messenger attachments.

## Main gallery group filter

The main Videos/Photos pages have a **Messenger group** dropdown in the left
navigation (mobile menu drawer). **NONE** is the first option and queries all
public media. Selecting a group shows only media explicitly assigned to that
group, including its public and private assignments. The selection follows the
Videos/Photos tabs; My Videos/My Photos keep their existing personal library scope.
No media is moved, copied or changed by filtering.

Migration `20261019030000_media_group_filter.sql` adds two read-only,
authenticated RPCs: `media_filter_groups()` lists all current member groups,
including those with no media; `group_media_ids(type,group)` returns that group's
assigned IDs. Both require an active account, and the latter rechecks current
membership even for site administrators. Final media SELECTs retain RLS. No new
tables or access grants are introduced. Empty/error results never fall back to
unrelated public/private content.

`MediaGroupFilter.tsx`, `useMediaGroups.ts`, `useDiscoveryMedia.ts`, `App.tsx`,
`HomePage.tsx` and `PublicPhotoGallery.tsx` implement the selector, account-scoped
state and shared discovery query. Membership/media changes, reconnect, focus and
returning to the page refresh the filter; a removed/deleted group resets to NONE.
Old requests cannot replace results after switching groups/accounts. Private
photos display a Private badge and use the existing protected image gateway.

The PostgreSQL regression covers filter isolation, invalid/anonymous/nonmember
requests and membership changes. `media-group-filter.mjs` exercises desktop/mobile
discovery, Videos/Photos tab continuity, NONE/public, empty/error/retry, late
responses, removed-group reset and guest behavior in Chromium, Firefox and WebKit.

### Upload directly to the selected group

Header/sidebar uploads and main-gallery drag-and-drop capture the current group
when the dialog opens. Single and batch video/photo uploads show the group name,
remain private, retain the uploader as owner, and stay on that group gallery after
acceptance. NONE and personal-library uploads keep the ordinary personal flow.
An account switch hides the previous account's upload form. Background membership
refresh cannot silently change an open form's destination.

`20261019040000_group_media_uploads.sql` adds `media_upload_jobs.upload_group_id`
and a private-only group constraint/index. The verified-user queue Edge function
passes group requests to service-only `queue_group_media_upload`; ordinary uploads
still use `queue_media_upload`. The server derives the owner from the authenticated
token, validates current group membership, and rejects changes to an existing
job's destination. Preview replacement never accepts a group target.

The existing validated publisher/worker remains in place. A completion trigger
rechecks membership/account state under the group's membership-mutation lock and
inserts the media grant in the publication transaction. Grant failure, removal or
group deletion rolls back the media row and job completion together. The job's
destination UUID intentionally survives group deletion so a pending group upload
cannot silently publish as personal content. Completed originals remain intact
when a group is deleted; only their group grants cascade. Existing cleanup only
handles new unpublished upload objects, as before.

Group video galleries show the uploader's processing jobs for that group only;
the existing polling/refresh path adds finalized videos without a page reload.
Photos appear after processing. Tests cover the real Edge queue and SQL publisher,
idempotent acceptance/publication, forged identity/role/target rejection,
membership revocation, injected grant failure rollback and ordinary uploads.
Browser tests cover header/sidebar/picker/drop, single/batch videos/photos,
private defaults, no personal redirect, completion refresh, rejection in the form,
destination stability during membership refresh and duplicate-submit protection.

## Actions and authorization

Messages menu: **Create Group**. Group menu: **Edit Group**, **Manage Members**
(owner/group admin), and **Delete Group with Content** (owner/site administrator).
The existing group information view remains readable by members. Creator becomes
Owner; existing owner succession on Leave Group remains intact.

Site administrators have a **Manage all groups (Site Administrator)** directory
in the Messages menu, with search/pagination. They can delete a group without
joining it. This directory does not grant access to private message history.

`messenger_groups_rpc(p_action,p_group,p_data)` accepts `admin-list` and `delete`.
The server checks `auth.uid()`, active account, and either the actual owner/member
role or `is_admin()` from profiles. It ignores frontend role/owner/user claims.
Group Admin remains distinct from Site Administrator. Older
`messenger_rpc('delete-chat', scope:'everyone')` calls route through the same
restricted deletion action. Other existing message-clear permissions are unchanged.

Confirmation names the group and states permanent deletion for everyone, Messenger
content cleanup and preservation of original library media. Administrator actions
are identified. `useDeleteGroup` invokes the mutation only inside shared
`useDeleteConfirmation.onConfirm`. Cancel/outside/Escape/pending/error/retry behavior
comes from the shared confirmation provider. Server access is independent of
confirmation state. Authenticated RPCs use bearer sessions, not cookie-only writes.

## Schema and APIs

Forward migrations:

- `20261019010000_messenger_group_sharing.sql`: `media_shares` with typed video/photo
  foreign keys and either a person or group target, creator/time, unique grants,
  RLS/no direct browser writes. Group FK cascades grants only. Notification events
  gain a conversation FK so group deletion cascades events and delivery jobs.
- `20261019020000_shared_image_gateway.sql`: private `image_access_grants` stores
  hashed random capabilities bound to verified user/session, exact object path and
  expiry. No storage signing rights are added for shared recipients.

`media_sharing_rpc(type,id,'get'|'save',data)` is owner-only. One transaction saves
people, groups and visibility. New group grants require uploader membership; an
existing grant can still be retained/revoked after the uploader leaves. Invalid
targets roll back the complete save. Groups/membership mutations serialize on the
same conversation lock. Existing person/group grants are preserved instead of
deleted/reinserted. Public/24-hour sharing remains separate.
The dialog loads current server visibility and a grant revision fingerprint;
stale saves are rejected atomically, so another tab's new grants cannot be silently
removed without appearing in the confirmation.

`shared_media_ids(type)` returns only the signed-in user's current grants. My Videos
and My Photos combine these IDs with owned media, with final table RLS checks.
The normal library toolbar/search/navigation and read-only recipient menus remain.

`media_access_for_user` centralizes public, owner, site admin, person grant and
current group membership. `can_read_media` adds SELECT RLS for cards, metadata and
search; `can_access_reaction_media` also protects reactions and analytics view
recording. Shared grants do not allow editing, deleting or resharing originals.

The existing `serve-media` gateway and `video_playback_allowed` reauthorize live
membership/session on issuance and every range/GET/HEAD request. Its implementation
is reused without changing playback controls. `serve-shared-image` authenticates
issuance and rechecks a hashed capability on every image request. It streams exact
registered originals, photo previews/thumbnails and video posters with no-store;
it never redirects to a signed Storage URL. Downloads use the same gateway when
the recipient cannot directly access Storage. Private shared posters do not use
legacy unauthenticated image fallbacks. Existing owner/public Storage reads remain.

## Deletion, membership and realtime

Group deletion scrubs message data/legacy deletion plans and queues only Messenger
attachment bytes/derived previews in existing retryable storage cleanup queues.
Conversation deletion cascades memberships (including mute/read state), messages,
reactions/replies/hides/send receipts, calls/signals, notification events/deliveries
and group media grants. Text-free request receipts survive for safe idempotent retry.
Pending unsent attachments also cascade through existing attachment cleanup.

Original videos/photos, thumbnails, upload records and library reactions are not
deleted. Independent user/other-group grants remain. Leaving/removal immediately
changes server authorization; joining grants access without copying grant rows.
An already downloaded byte sequence cannot be recalled, but subsequent URL requests
are denied, including saved gateway URLs, until access is granted again.

Private per-user broadcasts invalidate libraries on grant/member changes.
`group-deleted` is queued before memberships disappear; removed members also receive
their own revocation event. Account-specific conversation tombstones prevent stale
requests/pagination resurrecting removed cards/messages. Focus/reconnect reloads
authoritative data. A snapshot started before revocation cannot restore it; a fresh
authorized snapshot can restore a group after a missed re-addition event. Successful
local deletion also invalidates immediately even without realtime. A read-only
notification membership snapshot closes inaccessible
in-site/system alerts while the app/worker is awake, including after reconnect.
Suspended operating systems cannot be forced to retract a previously delivered
notification immediately; no replacement or silent-only push is introduced.

## Files/components

- Backend: the two migrations, `serve-shared-image/index.ts`, `supabase/config.toml`.
- Management: `Messenger.tsx`, `MessengerDialogs.tsx`, `useDeleteGroup.ts`,
  `messenger.ts`, `messengerVisibility.ts`, `MessengerContext.tsx`.
- Sharing/access: `MediaShareModal.tsx`, `MediaContentMenu.tsx`, `sharedMedia.ts`,
  `StorageImage.tsx`, `MediaVideoCard.tsx`, `VideoLibrary.tsx`, `PhotoLibrary.tsx`.
- Alert cleanup: `NotificationContext.tsx`, `public/notifications-sw.js`.
- Safety inventories: `DELETE_SAFETY.md`, `MODAL_SAFETY.md`.
- Tests: `messenger-group-sharing-db.mjs`, `shared-image-gateway.mjs`,
  `messenger-group-visibility.mjs`, group-sharing browser fixture/harness/tests,
  notification worker tests, core/UI regression runners and CI browser compatibility.

## Validation

Tests use isolated PostgreSQL, mocked external Auth/Storage I/O and local browser
fixtures; they never modify production groups, messages or media. Test outcomes
include eight database scenario groups, two actual Edge-handler groups, three
conversation-cache tests, and 16 desktop/phone group-sharing checks per browser
engine. The full core suite, existing Messenger deletion/people/context-menu UI,
public previews/consumption, mobile media gestures and notification regressions
were also run. Type-check, lint, production build and npm advisory audit pass
(zero vulnerabilities; existing large-chunk build warning remains).
Physical iPhone/Android OS behavior and actual production user flows require
separate manual verification; viewport/WebKit automation
is not a claim of physical-device testing.
