# Gallery video player recovery

Candidate implementation; not committed, pushed or deployed by this work.
The user reports Android closing works and the remaining device failure is iPhone.
Physical iPhone Safari testing remains required after deployment; Windows WebKit
automation is not Safari or an iPhone.

## Confirmed regression

Compared `2088f07` and `9fd8471` with the native-controls player in `2340373`.
The intervening player changes made closing conditional on browser operations:

- `useVideoCompletion.close()` awaited `waitForVideoPresentation()` before closing.
  A native void API without a corresponding event left that promise unresolved.
  The player stayed mounted with Close disabled.
- Fullscreen/PiP exit rejection skipped the close callback and remaining cleanup.
  A failed optional browser feature therefore retained the modal.
- `useVideoPresentation` tracked pending native operations and disabled both mode
  controls while waiting for events that might never arrive.
- The fullscreen capability check treated an absent enabled flag as support,
  allowing an unsupported container path to precede the iPhone video fallback.

The old revision reproduced the trap in a local WebKit fixture: rejected exits
left the modal open, and silent native/hung standard entry left Close disabled.
Click instrumentation confirmed the Close button received the click; this was
not an overlay or pointer-event failure in that reproduction. No deferred effect
calling fullscreen, crossed PiP callback, or lost user activation was established.
The exact native behavior on the user's iPhone still needs a device retest.

## Changes

- `src/hooks/useVideoCompletion.ts`: one synchronous close function pauses media,
  independently attempts display-mode cleanup, releases the source and always
  invokes the parent close callback. No pending browser operation disables Close.
- `src/components/VideoPlayer.tsx`: restored native playback controls and an always
  available X. Direct React `onEnded` invokes that same close function. Pause,
  buffering, errors and seeks do not request closing; direct seeks to the end are
  excluded. No duration timer is used.
- `src/components/FilePreview.tsx`: intentionally shares the same completion hook
  and native controls. Fetching, conversion, permissions and original files remain
  unchanged.
- `src/lib/videoFullscreen.ts`: removed the pending-presentation WeakMap and exit
  waits. Owned standard fullscreen, standard PiP and native WebKit cleanup are
  independently attempted; rejection cannot abort modal removal.
- `src/hooks/useVideoPresentation.ts` and `VideoPresentationControls.tsx/.css`:
  separate fullscreen/PiP click handlers call the APIs directly from the gesture.
  Standard enabled flags and native capabilities select the supported API.
  Browser/native events confirm modes. Native void methods create no pending
  application state. Unsupported programmatic PiP is hidden; conflicting mode
  controls require exiting the current mode first. Existing fullscreen sizing and
  aspect-ratio containment are preserved.
- `tests/video-player-recovery.mjs`: replaces the old completion/presentation
  suites, whose assertions required retaining a trapped player. Checks run in
  order: Close, natural end, fullscreen, PiP, then combinations. Real local media
  is used; native fullscreen/PiP API behavior is simulated.
- `tests/public-consumption.mjs`: updated cleanup expectations and waits for the
  asynchronously rendered PDF text before checking it.
- UI runner and CI: Chromium, Firefox and WebKit player recovery gates.

TaskModal retains focus, background inertness and scroll ownership. No overlay
or Escape dismissal was introduced. Backend authorization, media processing,
thumbnails, authentication, calls and infrastructure were not changed.

## Validation and release limits

TypeScript, full ESLint, JavaScript syntax checks, diff whitespace checks and the
production build pass. Public-consumption regressions pass in Windows Firefox,
Chromium and WebKit at desktop, phone and tablet widths. Ordered player recovery
checks pass in all three engines: manual Close, natural end, independent fullscreen,
independent PiP, repeated transitions, simulated system exit and viewport rotation.
Close also passes with loading/buffering media, rejected exits, silent native entry,
hung standard entry and an intentionally withheld ended handler after real playback
finishes. Reopening, source release, scrolling and inertness cleanup are checked.
Browser-mode fixtures verify API calls with user activation and unsupported PiP;
native fullscreen/PiP methods and events in these fixtures are simulated.

Chromium and Firefox actual container fullscreen pass first-click entry, full viewport
geometry with aspect-ratio containment, repeated exit/re-entry and natural-end
cleanup. Actual desktop browser tests do not replace physical mobile coverage.

Android: user reports normal closing. No physical Android test was run here.
Safari/iPhone/iPad: no physical test was run here. The user agreed to retest Safari
after deployment. Do not describe this candidate as a confirmed iPhone fix until
manual Close and natural-end auto-close pass on that device, both inline and in
native fullscreen. Native fullscreen uses system controls rather than the page's
custom header. Browsers that do not deliver an ended event cannot be promised
automatic closure from that event; the page Close path remains unconditional.

Device retest order: Open/Close; Open/play to end; Fullscreen/Exit/Close; supported
PiP/Exit/Close; then repeats, orientation changes, system exit and natural end
while in each mode. Verify the gallery is usable and another video reopens.

## CI follow-up for db2e4f9

The user's pushed candidate failed in the WebKit step of
[CI run 38497715201](https://github.com/maple289/website/actions/runs/38497715201).
Chromium and Firefox browser steps, typecheck, lint, core regressions, build and
media validation passed. Deployment was skipped, so that run did not publish the
player candidate.

The failure occurred in `public-consumption.mjs` before `play()` was called:
the test scrubbed a paused video to the end, rewound it and waited for the rewind
to finish. Natural-end testing now opens a fresh video after explicitly checking
Close following the direct-to-end seek. Both playback helpers start real playback
without an unnecessary setup seek and explicitly assert playback rejection errors.
No ended event is synthesized and no production player code changes in this follow-up.

Local validation also exposed a timing race in the old 90-ms simulated fullscreen
exit. The test now holds the exit unresolved until after asserting modal removal,
then explicitly completes it. This deterministically verifies that Close does not
wait for an exit promise/event. The Linux CI rerun and physical Safari device
retest remain separate release checks.

The corrected public-consumption and full player-recovery suites pass locally in
Windows WebKit, Firefox and Chromium. ESLint, JavaScript syntax and whitespace
checks pass. These follow-up changes are uncommitted and have not been pushed;
the remote Linux CI result cannot be confirmed until the new revision runs there.
