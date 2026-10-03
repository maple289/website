# Delete-action inventory

Admin analytics add only cascading derived records and cache invalidation. They do
not add deletion controls, deletion history or another caller of a delete helper.
The existing sharing Save RPC now preserves unchanged grants; actual saved removals
still use the same owner check and confirmed UI operation.

All destructive UI operations use the application-level confirmation provider.
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
| Trash rows and menus | Permanently delete files/folders and contents | Owner-only storage and metadata policies |
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

Media records are retained until storage cleanup succeeds. Storage and database
operations are not one distributed transaction: partial storage failures are
reported explicitly and retries can finish the cleanup. Folder/bulk failures reload
actual state, retain remaining selections, and skip fully completed targets on retry.

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

File-preview jobs are derived data. Source deletion, replacement, move, Trash or
account deletion invalidates their cache through database triggers/cascades.
The preview worker removes cached PDFs through the Storage API and retries failed
cleanup. Cancellation terminates the decoder before temporary files are removed.
This internal cleanup never deletes or modifies original uploaded documents.
