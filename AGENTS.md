# Application deletion safety

- Route every user-initiated destructive action through `useDeleteConfirmation`
  and `DeleteConfirmationProvider`. Perform the mutation only inside `onConfirm`.
  This includes menus, keyboard shortcuts, viewers, bulk actions, account deletion,
  saved sharing removals and deletion/replacement of saved previews.
- Reaction removal is an explicit, reversible toggle exception: clicking the
  applied reaction removes it immediately, without a separate remove action or
  confirmation. Changing a reaction replaces it. Preserve the server permission
  check and pending-request guard.
- Name the target. For bulk actions, give the selected count. For folders, explain
  that all contents are included. Distinguish moving to Trash from permanent deletion.
- Describe only the cascades the backend actually performs. Account deletion does
  not automatically remove uploaded storage objects.
- Confirmations close only through Cancel or a successful explicit confirmation.
  Never dismiss on outside taps/clicks or Escape. Disable actions while pending and
  use a synchronous guard against double submission.
- Keep errors in the confirmation and update lists only for successful mutations.
  Explain partial completion and make retries skip already completed items.
- Retain server-side authorization and RLS. A confirmation flag is not permission.
- Automatic rollback of newly uploaded, uncommitted temporary files is internal
  cleanup, not a separate user deletion action. Never broaden such cleanup to
  pre-existing user content. Replacing saved content requires confirmation.
- Audit the deletion paths listed in `DELETE_SAFETY.md` when adding or changing any
  destructive action. Do not introduce a second, unguarded caller of a delete helper.

# Modal safety

- Use TaskModal (or useModalLayer for specialized viewers) for task dialogs.
  Never dismiss them from overlay clicks/taps or Escape.
- Use useGuardedClose on explicit Cancel/Close when a draft differs from its saved
  values. Discard confirmation must preserve the original form on Keep Editing.
- Successful saves may close directly; block closing while requests are pending.
- Keep modal focus, background inertness and scroll locking in the shared layer.
- Leave dropdowns, context menus, tooltips and reaction bars lightweight.
- Review MODAL_SAFETY.md when adding or changing dialogs.
