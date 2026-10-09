# Messenger deletion scopes

## Menus and confirmation

- Every message has Delete message. The confirmation defaults to Delete for
  myself. Only its author is offered Delete for everyone; the server checks this
  independently, including for group owners and site administrators.
- The conversation menu includes Clear messages and Delete chat. Scope selection
  alone performs no mutation. The scope-labelled confirmation button runs the
  operation through `useDeleteConfirmation`.
- Outside clicks and Escape never close the confirmation. Requests lock the
  actions synchronously; failures remain in the dialog for Cancel or retry.

| Action | For myself | For everyone |
| --- | --- | --- |
| Delete message | Save a hide marker for the authenticated user | Author only: erase body/reactions/attachments; retain a deleted-message placeholder and reply IDs |
| Clear messages | Advance that member's history cutoff | Either participant in a direct chat; Owner/Admin in a group: erase the confirmed history and advance the shared cutoff |
| Delete chat | Direct: hide the inbox entry and preserve history; group: leave and revoke access | Groups only, Owner/Admin: delete the conversation and its related records |

History counts and the last message sequence are fetched before confirmation.
Clear targets only that captured range, so messages arriving while the dialog is
open or after confirmation survive. Text-free per-user request receipts prevent a
retry after a lost response from clearing newer messages. Receipts intentionally
retain the conversation UUID after group deletion without retaining message text.

Direct chats reappear after a new message, or when the participant explicitly
starts the same direct chat again. A member who leaves a group must be added again
by a group administrator. Existing ownership succession is preserved.

## Storage, access and synchronization

Everyone deletion revokes attachment access and removes preview-job metadata in
the same transaction as the message mutation. Original attachment and cached-PDF
bytes are queued for permanent deletion by the existing preview worker. Cleanup
failures remain queued and are logged/retried; no browser can read these private
objects directly. Per-user deletion never queues another member's content for
removal. Original library videos/photos/files are unaffected.

The same visibility helper filters history, single-message lookup, reconnect
snapshots, search, shared-file lists, preview/download authorization, reply quotes
and unread counts. Deleted quotes use placeholders; hidden quotes do not expose
their text. Reactions and edits are rejected for deleted or locally hidden messages.

Notifications refresh the affected user's sessions for local changes and all
members for shared changes. Open search/shared-file lists refresh with revisions;
stale page responses cannot restore entries from an older list generation.

## Migration and validation

Deploy the forward migration
`20261008040000_messenger_scoped_deletion.sql` with the frontend and Edge Function.
Earlier migrations are unchanged. Existing members/messages default to visible,
uncleared history; no existing content is deleted by the migration.

The new helper functions and hide/receipt tables are inaccessible to anonymous or
authenticated browser roles. Mutations remain behind the authenticated Messenger
RPC. Older clients' delete actions are adapted to the same scoped deletion logic.

TypeScript, targeted lint, production build and SQL/PL/pgSQL parsing are checked.
No production conversations were deleted, and no automated behavioral or device
tests were run for this change.
