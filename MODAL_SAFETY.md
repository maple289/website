# Modal safety inventory

Video/photo upload dialogs capture the selected discovery group and account at
open, display the destination, and preserve TaskModal/useGuardedClose behavior.
Group uploads are private; a membership refresh cannot silently redirect them.
Single forms use a synchronous pending guard; batch uploads retain the existing
worker/pending guard. Queue errors stay in the form, while successful group uploads
close without navigating away from the selected gallery. Ordinary uploads retain
their personal-library destination. Outside/Escape never closes either flow.

Messenger Edit Group / Manage Members retain `ChatDialog` / `TaskModal` and
`useGuardedClose` for the group-name draft. Keep Editing preserves the form.
The Site Administrator group directory also uses `ChatDialog` / `TaskModal`;
permanent deletion opens the shared named confirmation above it. Outside/Escape
never closes either layer. `MediaShareModal` uses `TaskModal`, guarded Cancel for
unsaved visibility/person/group choices, a synchronous save guard and disabled
pending controls. Removing saved access opens the shared confirmation, retaining
errors there and preserving the underlying form on Cancel.

Messenger foreground incoming alerts use a lightweight compact notification card.
Its Answer/Decline buttons call the existing engine; opening the complete incoming
call interface from the card or a system notification retains TaskModal. A card
never dismisses a call on an outside tap or Escape. The stable fullscreen call
container uses useModalLayer, including for the CSS fullscreen fallback.
Overlay taps and Escape never hang up or dismiss an invitation. Browser-native
fullscreen exit restores the floating layout through fullscreenchange; the
explicit Exit fullscreen button also restores it. Accept/Decline/End control the
call lifecycle. Remote hang-up/timeout removes unavailable invitations. Pending
media requests disable closing controls. Calls have no editable draft. The
floating call panel is nonmodal so users can continue browsing.

## Shared behavior

VideoPlayer and video-file previews close on the media element's natural ended
event. Seeking directly to the end leaves the player open in browsers without
native touch WebKit presentation support. Native touch WebKit accepts an ended
event even after seeking and checks actual ended state after seeking and on
native presentation changes;
seeking to the end can therefore close that player. Pause, buffering, errors and
presentation changes before completion do not close it. Manual Close and the
video element's direct React ended handler use the same
synchronous close function. It pauses playback, independently attempts owned
fullscreen/PiP exits, releases the source and always removes the player. Rejected
or unresolved browser operations never disable Close or retain the modal. The
shared modal layer restores focus, scrolling and the gallery position. See
VIDEO_PLAYER_RECOVERY.md for the regression evidence and device-testing limits.

Gallery and video-file players retain native playback controls and a small
application bar for optional fullscreen and PiP actions.
Standard PiP return preserves playing/paused state during the fullscreen handoff;
its leave event does not run fullscreen-exit cleanup. Recovery is limited to the
same connected source, excludes native dismissal/background playback and respects
subsequent manual Pause. Close remains unconditional and cancels recovery listeners.
The normal gallery player retains its previous sizing. On coarse pointers,
fullscreen gives the video the entire viewport; the header and application mode
controls overlay it, leaving the bottom native playback-control strip available.
Mobile gallery fullscreen fills the viewport and centers the complete video with
contain-fit sizing, preserving its aspect ratio without cropping. The application
mode bar hides after two seconds of playback, returns on
touch, and remains available during pause, buffering, seeking or keyboard use.
In the mobile page fullscreen fallback the same idle deadline temporarily hides
the native Pause/skip menu through the media element's controls property. Touch,
keyboard use, pause, seeking, buffering and exit restore it. Keyboard focus in
native controls keeps them available; the first revealing touch cannot trigger
a newly exposed playback button. Desktop and real element fullscreen retain
browser-owned native controls. Video/source and fullscreen geometry are unchanged.
Download stalls with playable buffered data do not reveal the bar. Current media
readiness/progress restores auto-hide after buffering without a latched waiting flag.
If WebKit reports only current data while the playback clock advances, a scoped
mobile fullscreen probe supplies expiring progress evidence. A stopped clock
reveals controls; seek/wait/pause invalidate earlier evidence. Exit, source changes
and unmount stop the probe. Healthy readiness and desktop behavior are retained.
Hidden buttons are inert; keyboard input reveals them before shared focus handling.
The first revealing touch cannot activate a newly exposed Exit button. Close remains
visible, and exit/source changes/unmount clear timers, listeners and hidden state.
Fullscreen and PiP requests run directly in their respective tap handlers, with
no queued entry effects or pending operation state. Actual browser/native
events drive mode state; conflicting entry buttons require exiting the current
mode first. Supported container fullscreen retains the header/Close and controls.
Touch WebKit keeps the same video in a page-controlled fullscreen viewer, with a
fixed viewport fallback when container fullscreen is unavailable or ineffective.
On coarse pointers that fallback follows the visible viewport's size and offset
as browser chrome or orientation changes. Pinch zoom is left to the browser;
explicit exit and Close remove viewport overrides and listeners. Real element
fullscreen and fine-pointer desktop layout retain browser sizing.
This preserves both double taps on iPhone; its native system player owns the taps
and cannot provide the page's custom exit gesture. Player/preview modal roots use
stable body portals so ancestor layout cannot constrain that fallback. Button and
gesture share the existing presentation action and state; Close and natural end
remove the fallback and retain the shared focus/inert/scroll cleanup. Non-touch
native fullscreen compatibility and native mode event observation remain. Native
void APIs rely on browser events for mode confirmation without creating an
application wait. Unsupported programmatic PiP is hidden. TaskModal retains focus,
inertness and scroll ownership. Regression fixtures include real media, API
rejections and simulated native events; these do not replace a physical iPhone test.

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

Admin Statistics Reset All Statistics reuses DeleteConfirmationProvider and its
shared modal layer. Only Cancel or a successful reset closes the confirmation;
outside taps and Escape retain it. Pending requests block both actions and errors
stay inside the dialog. No editable draft or additional modal implementation is added.

Messenger New Conversation and group-member pickers share the paginated People
list. Direct selection closes only after successful server-authorized creation/
reopening; failure stays in the task. Pending selection disables list and close
controls, with a synchronous request guard. Group drafts retain useGuardedClose
and Keep Editing preserves names and selected members. TaskModal continues to
own focus, inertness and scroll locking; outside taps and Escape do not dismiss.

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

PhotoViewer portals its stable modal root to document.body so ancestor transforms,
overflow and gallery sizing cannot constrain fullscreen. Its fullscreen button and
touch double tap share usePhotoFullscreen and one mode state. Supported container
fullscreen uses browser events to synchronize exit; unsupported/rejected entry
retains a fixed viewport fallback with contain-fit images. Navigation retains
fullscreen, explicit Exit returns to the normal viewer, and Close/unmount releases
owned fullscreen without waiting for browser operations. Outside taps and Escape
do not dismiss the viewer; useModalLayer still owns focus, inertness and scroll locks.
Video media double tap invokes the existing presentation button action, including
the touch-WebKit page fallback. See MOBILE_MEDIA_FULLSCREEN.md for validation limits.

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

## Messenger dialogs

New Conversation/Create Group, Edit Message, Group Information/Members,
conversation search, shared files, blocked users and profile information use
TaskModal. Editable creation/edit/group-name drafts use useGuardedClose for X /
Cancel; Keep Editing preserves the underlying form. Pending form requests block
closing. Message deletion and group membership/blocking confirmations use the
shared provider. Attachment previews reuse FilePreview's TaskModal and current
membership authorization. Menus, reaction bars/details and the notification panel
remain lightweight. No automated interaction checks were run for Messenger.

Scoped message deletion, Clear Messages and Delete Chat use the same confirmation
provider with explicit radio choices and a scope-labelled confirmation button.
Choosing a scope alone does not mutate data. Cancel/outside/Escape/pending behavior,
focus containment and scroll locking remain in the existing shared modal layer.


## First-login temporary password

The normal AuthModal retains TaskModal and guarded close. Request temporary
password uses the same synchronous pending guard and disables form actions.
The initial-password page now contains only New Password and Confirm New
Password; Return to sign in protects both draft fields and Keep Editing retains
them. A synchronous guard prevents duplicate saves. Browser fixtures cover
desktop, tablet, portrait and landscape, draft preservation, expiration errors,
resend and completion; no live applicant emails are sent by tests.
