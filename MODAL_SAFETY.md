# Modal safety inventory

## Shared behavior

TaskModal uses useModalLayer for focus containment, restoring focus, nested
layer handling, background inertness and body/document scroll locking. Overlay
clicks/taps never cancel. Escape never dismisses a task dialog. Background file
drops are intercepted. Existing responsive panels and dimming are preserved;
coarse pointers receive larger button targets.

useGuardedClose compares the form's draft to its initial/saved values and uses
the existing confirmation provider for **Keep Editing / Discard**. The underlying
dialog stays mounted with its draft intact. Unchanged forms close immediately.
Busy forms cannot close. Completed saves bypass discard prompts.

## Inventory

The common content context menu remains lightweight. New media Rename/Share,
temporary-link and file name-conflict dialogs use TaskModal. Rename/Share drafts
and Move destination selection use useGuardedClose; pending requests block
explicit closing. Temporary-link replacement/revocation and file conflict Replace
use nested shared confirmations, retaining the underlying task on Cancel/error.
Copy itself only sets the account-bound clipboard; Paste's task displays its
captured current destination and keeps partial-transfer errors for retry.
Restore also uses the shared file action task and conflict dialog. Requests block
closing, errors remain in the task, and cancelled conflicts leave Trash intact.

| Area | Protected surfaces |
| --- | --- |
| Authentication | Sign in/registration; name/email/password draft; registration success stays until explicit close |
| Videos | Upload draft, edit name/privacy/preview, batch-upload progress, player |
| Photos | Upload draft, edit name/privacy, batch-upload progress, full viewer |
| File Manager | Create folder, rename, move/copy, upload progress, file preview |
| Sharing | Selected users, Everyone state and unfinished user search |
| Administration | Add/edit user forms; role-change confirmation |
| Deletion/approval | Existing global DeleteConfirmationProvider, including nested confirmations |
| Account settings | Password section collapse/clear; Settings ESC/header Back/browser Back and Forward protect password/profile drafts |
| Initial password | Return to sign in protects the unfinished password |

PhotoViewer uses the shared hook directly to retain keyboard, wheel and swipe
navigation. Reaction detail popovers portal into their active modal so their
controls remain inside the focus boundary.

Dropdowns, context menus, informational sidebars, tooltips and reaction hover bars
are not task dialogs and keep their lightweight dismissal. Route/browser navigation
is not globally intercepted by this modal policy. Settings additionally registers a
history guard; see SETTINGS_NAVIGATION.md.

FilePreview uses TaskModal for the public and private Files interfaces. Loading,
queued conversion, failures and unsupported-file information stay inside the
same modal. Close aborts fetches/polling and releases local Blob URLs, retaining
the current folder, selection and browser-history entry. It has no editable draft.

## Scope of validation

TypeScript and production compilation checked. No automated UI or physical-device
interaction tests were run. Backend permissions and delete mutations are unchanged.
