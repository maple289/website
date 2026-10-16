# Delete-action inventory

Admin Statistics Reset All Statistics uses `useDeleteConfirmation`; only its
`onConfirm` invokes `admin_reset_statistics`. This changes a reporting timestamp,
preserves content and raw analytics, and writes a private reset audit entry.
Cancel/outside/Escape/pending/retry protections come from the shared provider.
The RPC independently requires an authenticated, active administrator.

Admin analytics add only cascading derived records and cache invalidation. They do
not add deletion controls, deletion history or another caller of a delete helper.
The existing sharing Save RPC now preserves unchanged grants; actual saved removals
still use the same owner check and confirmed UI operation.

Audit remediation adds database guards for Auth deletion, administrator demotion
and disablement: the last active administrator cannot be removed. Account deletion
still does not automatically remove uploaded storage bytes. No new user-delete
caller is added. Unfinished Move/Copy/Restore operations use owner-bound durable
receipts; their Resume mutation runs only inside the shared confirmation's
`onConfirm`. Saved source versions/destination identities are checked before
continuation. An uncertain copy destination stops for review, never overwrite.

All destructive UI operations use the application-level confirmation provider.

Files/Folders Delete still marks the owned tree as Trash inside `onConfirm`.
When Paste/Move/Rename needs that deleted name, its server plan first preserves
the fully trashed payload under a unique path; it never removes bytes or clears
Trash flags. Original names/locations remain available for Restore. Restore uses
the same conflict choices as transfers; replacing a live destination remains
inside the existing deletion confirmation. Permanent deletion still runs only
from Trash's confirmed helper, including the complete archived folder tree.
The archive plan retains completed steps for retries after partial failure.

Content cards now share `ContentContextMenu`; their Delete actions still enter
the same confirmations. Temporary-link revocation/replacement and removal of
public access from the new media menus also use `useDeleteConfirmation`. File
conflict Replace preserves the named existing file/folder tree under a unique
name, then moves it to Trash, entirely inside `onConfirm`. The incoming transfer
runs in that same callback. Partial replacement retries retain completed steps,
refresh actual state and keep errors in the confirmation. No additional permanent
delete helper or unguarded Trash caller is added. See `CONTENT_CONTEXT_ACTIONS.md`.
It captures the target before displaying the warning, focuses Cancel, traps focus,
makes the underlying application inert and prevents outside/Escape dismissal.
Only the confirmation button runs the callback. A synchronous lock guards duplicate
requests; errors leave the dialog open for Cancel or retry.

| Surface | Guarded operation | Server authorization |
| --- | --- | --- |
| Video gallery cards | Permanent video, stored versions and preview deletion | `delete-video` validates session; owner-bound RPCs, worker cancellation and storage cleanup precede record deletion |
| Video processing cards | Cancel/delete queued, running or failed uploads | Same confirmed `delete-video` operation; waits for worker acknowledgement before cleanup |
| Photo gallery cards | Permanent photo, preview and thumbnail deletion | Media/storage ownership policies |
| File Manager menus and right-click menus | Move files/folders to Trash | Owner-only metadata policy |
| Trash rows, menus and Delete All | Permanently delete files/folders and contents; Delete All captures every owned Trash metadata page, including unexpanded descendants | Owner-only storage and metadata policies; saved Trash state is rechecked before each target |
| File Manager bulk actions, including Tree View selections | Counted selection with recursive-folder warning | Same ownership policies for each target |
| Shared-content listings | Owner actions use the same guards; recipients remain read-only | Sharing grants allow reads, not deletes |
| Admin user management | Delete named account; explain database cascades and storage limitations | `admin-users` authenticates and checks administrator role; self-deletion remains blocked |
| Pending registrations | Approve consumes the pending row only after account creation; Reject retains the record with rejected status | Admin-only approval transaction/review endpoint |
| Video/photo cards and viewers, including public galleries | Reversible reaction toggle; latest user instruction explicitly removes separate removal actions and confirmation | RPC binds the toggle to `auth.uid()` and checks media access |
| Share dialog | Save removal of individual or Everyone permissions | Owner-only sharing RPC |
| Video edit dialog | Save deletion/replacement of an existing preview | Owner-only video/storage policies |

Sharing selections and preview edits are drafts until Save. If saving removes
existing data/access, confirmation appears before saving. Cancelling the confirmation
does not issue the mutation. Changing a reaction to another type remains an update;
removing it is a direct reversible toggle without confirmation. Favorite toggles change a reversible boolean,
without deleting the file or its metadata record.

Captured/uploaded video preview data URLs are decoded locally; the production
connect-src policy blocks fetching them. Replacement still runs only inside the
existing confirmation's `onConfirm`, validates/uploads before saving the video row,
and removes the old preview only after the new path is saved. A failed upload
retains the original preview, captured draft and retryable confirmation.

Media records are retained until storage cleanup succeeds. Storage and database
operations are not one distributed transaction: partial storage failures are
reported explicitly and retries can finish the cleanup. Folder/bulk failures reload
actual state, retain remaining selections, and skip fully completed targets on retry.

Trash's Delete All uses the same confirmed deletion callback as individual and
selected-item deletion. Its warning counts all files/folders, including nested
metadata, and explains permanent removal. Search results never supply its targets.
Restored/live descendants stop cleanup; folder metadata is removed after deeper
rows so partial failures remain retryable. Empty/loading Trash and pending requests
disable the action. Outside clicks and Escape retain the shared confirmation.

Analytics cache invalidation uses an explicit non-null cache primary-key predicate.
PostgREST preloads `safeupdate`; a cache DELETE without WHERE would roll back the
confirmed source deletion and leave a blank card after successful storage cleanup.
The forward migration `20261003010000_safe_analytics_cache_invalidation.sql` fixes
both source-removal and ownership-change invalidation without disabling this guard.

Video deletion retains a private server-only tombstone to prevent late publication.
The server removes the original, processed video, all previews under the video's
directory, related preview jobs and staging objects using their actual Storage
catalog keys (including Admin-configured base directories). It verifies the catalog
is empty before deleting records. Cancelled worker tasks terminate the decoder
process group and release their local temporary directory before acknowledging.
Completed upload jobs only refresh the video gallery; they never render Ready cards.

After confirmed deletion completes, `media-receipt-cleanup` removes orphaned local
TUS upload-receipt JSON files once their payload is absent. The private tombstone
retains the upload/preview job IDs needed for this cleanup. The cleaner validates
the owner, job, version and metadata identity, and never removes media payloads,
saved uploads, unconfirmed records or receipts whose payload still exists.

Other `.remove()` calls in uploads roll back newly created, uncommitted files after
failed uploads; they never implement a user-facing Delete action. JavaScript
Set/Map cleanup does not delete stored application content. There is no separate
pending-registration Delete button, storage-location Delete UI or viewer Delete
action beyond the surfaces listed above.

The database audit removes File Manager's browser rollback after a lost metadata
response: file metadata now commits with the Storage catalog. Worker compensation
is limited to new, unpublished uploads; the retry cleaner excludes older audited
objects, ready media, active claims and retained failed-video sources. Preview
cleanup first resolves a possibly committed Ready update. No new user-facing
delete caller or repair action is added.

File-preview jobs are derived data. Source deletion, replacement, move, Trash or
account deletion invalidates their cache through database triggers/cascades.
The preview worker removes cached PDFs through the Storage API and retries failed
cleanup. Cancellation terminates the decoder before temporary files are removed.
This internal cleanup never deletes or modifies original uploaded documents.

## Messenger

Call history uses the existing confirmed message/clear/chat deletion operations;
no separate history-delete caller was added. Hiding/deleting a history entry does
not end its call or erase private call metadata. Ending/declining a call changes
its session state; it does not delete saved history. Expired SDP/ICE rows are
internal temporary signaling cleanup and contain no recorded media.

Message Delete/Retry Deletion, Clear Messages, Delete Chat, Discard Pending Draft, Remove Group Member, Leave Group and Block User
are routed through `useDeleteConfirmation`; the mutation occurs only in
`onConfirm`. Message warnings name the text/attachment and accurately describe
the selected per-user/everyone scope. Single-message deletion removes the entire
card for the chosen scope; only private tombstones and reply IDs remain. Reply
references show “Original message deleted” after global deletion. Server visibility
excludes deleted/deleting rows in history, snapshots, pagination and inbox previews.
Authenticated private-channel deletion events remove cards immediately; per-account
in-memory tombstones also reject stale responses. Attachment/reaction cleanup and
server authorization stay in the existing confirmed RPC. Clear Messages counts
the affected history and captures its last sequence before confirmation; later
messages survive. Direct-chat deletion for oneself hides only that inbox entry,
preserves history and permits a new message to restore the chat. Group deletion
for oneself leaves the group; group deletion for everyone requires Owner/Admin.
All scope choices use the shared confirmation and mutate only inside `onConfirm`.
Saved hide state, history cutoffs and text-free request receipts make retries safe.
Everyone deletion atomically revokes attachment/preview access, removes reactions
and queues permanent source/cache cleanup in the existing retryable worker queues.
Membership removal/leave revoke access and retain history; blocking retains
history and leaves groups unaffected. Failures keep the confirmation available.
The server checks the authenticated author/membership or group role independently.
Search, history, snapshots, shared files, attachment downloads/previews and unread
counts use the same per-user visibility rules; hides never delete others' data.
Unsent attachment cancellation targets only newly reserved uncommitted objects;
derived-cache/reservation cleanup is internal and cannot delete library content.
Message reaction removal uses the existing immediate reversible-toggle exception,
with a pending guard and one database reaction per user/message.

- File Manager unfinished-transfer **Stop tracking** is confirmed through the shared provider.
  The owner-only RPC discards recovery tracking, retains completed files and moves,
  and performs no physical deletion or rollback.
