# Native Messenger

Voice/video calls, global notifications, screen sharing, floating controls and
hosted TURN deployment are documented in [MESSENGER_CALLS.md](MESSENGER_CALLS.md).

## Interface

Messages is a registered-user workspace item. Public Videos / Photos / Files
keep their existing routes and permissions. Guests render no Messages link or
notification bell, never initialize a chat channel, and cannot call Messenger
RPCs, upload attachments, or retrieve attachment bytes. The canonical page is
`#/messages`; conversation links use `#/messages?conversation=<uuid>`.

Desktop uses independently scrolling Conversations / Groups and People lists
beside the thread. People remains visible while chatting, has its own name/email
search, and highlights the selected direct chat with presence and unread badges.
Below 901px, New Conversation opens a searchable registered-user list; selecting
a person opens the thread and closes the task. The user list is not permanently
shown beside a mobile thread. An explicit Back button returns to conversations.
Messages load newest first
in 50-message pages; scrolling upward or Load Older retrieves previous pages.
The browser retains a moving window of up to 500 messages, and can continue
paging older history. Go to Latest returns to the recent conversation.

New Conversation opens an existing direct chat or creates one when necessary,
including reopening a chat previously hidden for the current user. Selecting a
person immediately opens their chat; group mode retains multi-selection and an
explicit Create Group button. Groups support up to 50
members. Each message has Reply and, for its author, Edit / Delete. A compact
reaction selector opens upward; selecting the applied reaction again removes
it, and a different reaction replaces it. Counts show names without a separate
removal control. Searches in the inbox match conversation/member names; Search
Conversation searches message words, with paginated results and reply links.

The header bell shows the total unread count, including muted conversations.
Its compact panel lists recent unmuted unread conversations. Zero hides the
badge. Muting suppresses that conversation's notification-panel entries without
altering its unread history. No browser push service or email notification is
introduced.

## Accounts, groups and blocking

Group menus, owner/site-administrator permanent deletion and dynamic private
video/photo group grants are described in `MESSENGER_GROUP_SHARING.md`.
Messenger group Admin and Site Administrator are separate permissions.

The existing Supabase account session is the only identity. Database functions
derive the actor from `auth.uid()` and reject inactive, banned, deleted or
password-setup-required accounts. Browser-provided member IDs choose recipients;
they never choose the actor. Display names combine available first/last names
and fall back to the account email when both names are absent. The directory
returns only ID, display name, session presence, the current account's direct
conversation ID, and unread count. Email filtering happens on the server; named
users' email addresses are not returned as separate fields.

`20261011020000_messenger_people.sql` adds the `people` RPC action with 50-user
cursor pages and literal case-insensitive name/email filtering, including empty
and one-character queries. More People makes every eligible user reachable.
The same existing active-account and bidirectional-block predicates govern the
directory and conversation creation. Pending password-setup/disabled/banned/
deleted accounts and accounts without profiles are excluded. Legacy accounts
remain eligible under the existing activation rules. The directory helper is
private; the authenticated RPC derives its actor from the session. Each loaded
directory page refreshes with the existing inbox/presence refresh cycle (including
realtime notifications, focus/reconnect and the 20-second active-page poll).
Account changes discard directory rows and search state. Selection always calls
the existing unique-pair/advisory-lock create action, so stale directory entries
cannot bypass permission checks or produce duplicate direct conversations.

Validation: `tests/messenger-people.mjs` runs the actual migrations and permission,
pagination, direct-chat reuse, unread/presence and group checks in isolated
PostgreSQL. `tests/messenger-people-ui.mjs` exercises the actual Messenger and
providers against fixture responses at desktop, tablet and phone portrait/
landscape sizes; it does not constitute physical-device testing. Apply the new
migration before deploying the frontend that calls `people`.

Group owners/admins can rename and add members. Only the owner assigns/removes
the Admin role. Admins cannot remove another admin or the owner. All members
can leave; ownership passes to the oldest remaining admin, then member. Newly
added members can read existing group history, but old messages are not counted
as new unread messages. Removing/leaving revokes further API/attachment access.
Messages already sent remain. A group with no members is not automatically
deleted. Existing account deletion does not become a conversation-history purge:
sent messages and attachments remain available to the remaining members. An
Office preview whose uploader account was removed can use an active member for
the existing preview queue's ownership/quota bookkeeping.

Blocking prevents direct sends in either direction and hides the pair from new
conversation user search. Existing history remains readable. Shared groups
remain usable. Blocked Users and the direct-chat menu support unblocking.

## Persistence and real-time delivery

Two forward migrations add conversations, members, messages, reactions,
attachment reservations, blocks, presence leases, send receipts and cleanup
queues. Foreign keys/cascades, unique direct pairs, unique message sequences,
unique `(sender, client_id)` and one reaction per `(message, user)` enforce the
relationships. A conversation lock allocates each sequence and serializes
membership/message mutations; a direct-pair lock serializes blocking with sends.
No direct browser access to chat tables is granted; bounded authenticated RPCs
check current membership. Internal helpers are not generally callable.

Private per-user Supabase Broadcast channels carry change identifiers only,
never message text or attachment URLs. Current members are selected by the
server on each notification. Private channel RLS permits only the authenticated
user's own notifications topic and denies browser publishing on Messenger topics.
Typing comes from a server-authenticated broadcast, expires after six seconds,
and is not stored as message/history data. Presence uses a 60-second lease,
refreshed every 20 seconds while the page is visible, plus a persistent Last Seen.
Offline status can take up to one lease interval to appear after a crash.

SDK reconnects refresh the authorized inbox and current thread. Loaded message
IDs are refreshed to recover missed edits/deletions; bounded sequence catch-up
retrieves missed new messages. Large gaps restart at the latest page with older
history still available. A visible, focused thread at the latest messages
acknowledges Read. Inbox retrieval acknowledges Delivery; Sent means database
commit. Group double ticks mean all current recipients present when the message
was sent have reached that sequence. Former members do not block receipts.

Send retries retain the same client request ID and payload. An uncertain network
response locks that draft until Retry Send resolves it. Send receipts survive
message deletion without retaining message text, so a late retry cannot recreate
a deleted message. Successful sends clear the draft before inbox refresh.
Discard Pending Draft uses explicit confirmation and a cancelled request receipt;
an in-flight retry cannot publish afterward. An already committed message remains.
Composer drafts survive switching conversations while Messages stays mounted;
they are not persisted in browser storage.

## Attachments and preview reuse

Private `messenger-attachments` Storage objects are reserved before upload and
bound to a committed message only after Storage size/completion is verified.
Limits are 100 MB per file, 10 files and 200 MB per message; the server's existing
global upload limit may be lower and still applies. Two upload lanes show each
file's progress/failure independently. A failed file does not stop the others.
Unsent attachment removal cancels only that new reservation.

Authenticated/anonymous Storage SELECT is explicitly denied for this bucket,
including creation of browser signed URLs. `messenger-media` checks the session,
active account and current conversation membership before every preview/download.
It serves private, no-store byte streams with safe content headers. Text is
rendered as text, not HTML; images/PDF use the existing bounded read-only viewer.
The file-type icons and FilePreview renderer are shared with Files. Downloads
keep the original name. Video preview relies on browser codec support; unsupported
formats can still be downloaded and do not enter public FFmpeg processing.

Office attachments use the existing private PDF cache and **one** bounded
LibreOffice worker, with the existing size/time/memory limits. Preview jobs now
include their source bucket; source ID/version/path/bucket are verified before
publication. Messenger previews do not increment Files analytics counters or
inherit public Files sharing permissions.

Deleting a message uses the shared named confirmation. Per-user deletion removes
only that user's card; shared message data and attachments remain for others.
Global deletion removes all participants' cards, reactions and attachment metadata
and revokes attachment/preview access in one transaction. Private tombstones retain
reply IDs and safe retries; surviving replies show a neutral deleted-original quote.
Private-channel events remove cards immediately, and account-specific tombstones
reject stale responses. Worker cleanup retries derived caches and deleted attachment
paths independently of the UI. See `MESSENGER_DELETION.md`. Uncommitted reservations
expire after 24 hours; reconciliation also catches late orphan upload completions
after a 15-minute grace period. It never targets existing library storage.

## Deployment

Local compilation is not evidence of live message exchange. No production schema,
data or services were changed during this implementation.

1. Use the existing `scripts/backup-database.sh` and verify the gzip backup before
   applying migrations. Retain the runtime environment and Storage backup too.
2. Deploy using `scripts/deploy.sh` from this checkout. It applies both migrations,
   synchronizes Edge Functions and rebuilds the existing preview worker/frontend.
3. The Realtime version must support private Broadcast, `realtime.send`, and
   `_realtime.tenants.private_only`. The migrations fail closed if those features
   are unavailable. The repository's pinned self-hosted release supports them;
   an older existing installation may need a Realtime upgrade first.
4. Include `deploy/messenger.compose.yml` in the runtime stack. The deploy script
   seeds only a missing Realtime tenant, then disables `SEED_SELF_HOST` and sets
   `private_only=true` through the deployment-only `supabase_admin` connection
   before application migrations. The migration verifies this setting without
   trying to update the internal tenant table as the restricted `postgres` role.
   No new tenant-table permissions are granted to application/API roles.
   The stock seed otherwise **recreates** the tenant on
   restart and resets this security setting. The script restarts Realtime to
   clear its cached tenant settings. Use the same override for later service
   operations; do not reseed an existing tenant.
5. For managed Supabase, disable Realtime **Allow public access** in its dashboard
   before enabling Messenger. Generic Supabase infrastructure is reused; no
   separate public chat endpoint is installed. Guests must be unable to join any
   Messenger channel even if they manually request a public channel.
6. Verify the existing HTTPS proxy forwards Supabase WebSocket upgrades. No new
   publicly exposed port is needed. FFmpeg remains in its existing separate,
   concurrency-limited worker; chat uses Supabase Realtime/DB/Edge services.

Restore uses the existing database backup procedure and matching application /
runtime configuration. Do not roll back only the frontend while leaving an old
preview worker that cannot resolve the new source-bucket field.

### Live acceptance checks still required

Use at least three approved test accounts and a logged-out session. Check direct
chat uniqueness, group roles/add/remove/leave, replies, edit/delete, reaction
toggle, user/conversation/message search, mute/block/unblock, presence, and each
receipt/unread state. Verify private attachment/Office preview and denied IDs
from a nonmember and guest. Try a dropped connection/send response, reconnect,
older history, partial deletion retry and membership removal during preview.
Check desktop/tablet/mobile layouts, touch controls, outside-click/Escape modal
safety, Keep Editing drafts, and notifications from other site sections. These
interaction/security checks have not been executed on a live deployment.

Static checks completed: frontend TypeScript, affected-source ESLint, production
Vite build, Edge source TypeScript with the installed Supabase types, PostgreSQL
and PL/pgSQL syntax parsing, deployment shell syntax, and preview-worker Python syntax. These do not prove
database migration semantics or real-time behavior on the server.
