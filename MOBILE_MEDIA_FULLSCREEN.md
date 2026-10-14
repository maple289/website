# Mobile media double-tap fullscreen

## Confirmed causes

Video: the fullscreen refactor in `2088f07` replaced native playback controls with
application controls (`controls={false}`), added `controlsList="nofullscreen"`, and
introduced `useVideoPresentation.toggleFullscreen` for the button. It did not bind
touch double tap or desktop double click to that action. `db2e4f9` restored native
playback controls but retained `nofullscreen` and still added no application gesture
binding. The missing application binding after this refactor explains why the
button could work while double tap did nothing. There is no removed custom video
double-tap handler in the repository history; the earlier player used native controls.

Photo: `cc864a9` deliberately made double tap toggle `expanded`. The `pv-expanded`
styles changed the stage and image width/height to fill the existing viewer. No
Fullscreen API was called and the viewer remained nested in the gallery. That was
application layout enlargement, not an image scale transform or a gesture-library
zoom implementation. The old handler already prevented default on a recognized
double tap, and the photo stage already allowed `pan-y pinch-zoom`.

## Implementation

- Video gestures call the same `toggleFullscreen` used by the Fullscreen button.
  Touch WebKit uses the page fullscreen viewer and attempts container fullscreen
  where supported. Missing, ineffective or rejected container APIs retain a fixed
  viewport fallback. The same video, native inline playback controls and source
  remain mounted in a stable body portal. Non-touch native API compatibility remains.
  Gesture entry executes directly in the second touchend; PiP stays independent.
- The shared touch recognizer uses a 300-ms interval, 12-pixel movement tolerance
  and 32-pixel proximity limit. It rejects multiple touches, swipes, cancellation
  and long presses. Video native control strips and the paused central play button
  are excluded. Capture listeners see events before native controls consume them;
  synthetic touch double-clicks cannot toggle a second time.
- Photo gestures and the accessible fullscreen toggle share `usePhotoFullscreen`.
  The complete modal root requests standard or prefixed container fullscreen.
  Missing/rejected APIs retain the same mode through a viewport-sized CSS fallback:
  fixed positioning, zero inset, 100vw/100dvh, no maximum dimensions and top-level
  stacking. A stable body portal escapes ancestor overflow and transforms.
- The image remains centered with `object-fit: contain`. Close, Exit, next/previous
  and reactions remain in the viewer. Swiping to another photo retains fullscreen.
  Browser fullscreen exit synchronizes the mode. Cancelled/delayed entries and Close
  clean up owned fullscreen, without exiting a newer requested mode.
- Double-tap zoom suppression is scoped to the media display. Video uses
  `touch-action: manipulation`; the photo stage retains `pan-y pinch-zoom`. No
  website-wide zoom or touch-action restriction was introduced.
- The existing modal layer still owns focus, background inertness and scroll locks.
  Outside clicks and Escape never dismiss the viewer.

## Validation

`tests/media-double-tap.mjs` uses real viewers and local media with mocked backend
APIs. It covers phone (390px) and tablet (768px) layouts, repeated entry/exit, mixed
button/gesture use, standard/prefixed/native video paths, independent PiP, gesture
exclusions, photo fullscreen geometry and controls, swipes, keyboard/wheel navigation,
rejected APIs, external exit and delayed-entry/Close cleanup. Screenshots confirm
the fallback background fills the viewport and the complete image remains contained.
The suite is included in the UI runner and Chromium/Firefox/WebKit CI coverage.

Local Chromium tests additionally use real touchscreen events and actual Fullscreen
API entry/exit for both media types. Desktop Chromium and Firefox double-click and
fullscreen buttons are checked; Firefox may fullscreen the native video itself.
The existing video-player recovery suite checks Close, natural completion, failed
browser operations, repeated presentation modes, rotation and fullscreen/PiP cleanup.
TypeScript, ESLint, JavaScript syntax checks and production compilation are checked.

Local results: the gesture and video-player recovery suites passed in Chromium,
Firefox and WebKit. Chromium public-consumption regressions also passed at desktop,
phone and tablet widths. TypeScript, full ESLint, syntax checks, whitespace checks
and the final production build passed.

These are Windows browser-engine tests, with mobile/tablet viewport and touch
emulation. Native-video WebKit APIs are simulated. Physical iPhone Safari, mobile
Firefox, Android Chrome and iPad/tablet testing was unavailable. In particular,
the real Safari retest must verify both taps in the new page fullscreen viewer;
mocked WebKit APIs cannot verify physical-device input. Remote Linux CI
and deployed-device results are separate checks.

## CI follow-up for 8e2267e

[CI run 38615618333](https://github.com/maple289/website/actions/runs/38615618333)
failed in the new Chromium gesture suite while waiting for the photo viewer to
return to normal after `document.exitFullscreen()`. Earlier validation, the video
recovery suite, and the gesture/fallback scenarios passed; deployment was skipped.

The new photo hook remembered native entry only through `fullscreenchange`. A fast
browser can fulfill `requestFullscreen()` before delivering that queued event.
If a system exit happens first, both queued events can observe a null fullscreen
element, leaving the CSS fullscreen layout and Exit label active. This was a
state-synchronization bug in the new hook, not a TypeScript/build failure.

Native entry is now also remembered when the fulfilled request observes the owned
fullscreen element. The existing change handler can then restore the normal viewer
on external exit. Rejection retains the CSS fallback, and delayed-entry cancellation
and Close cleanup keep their existing behavior. No fullscreen request is deferred
or duplicated, and video/PiP actions are unchanged.

The `coalesced` API fixture deterministically reproduced the stale UI before the
fix: entry fulfilled with the fullscreen property set but without an entry event,
then external exit delivered a change event with null. The same regression passes
after the fix in Chromium, Firefox and WebKit. TypeScript, full ESLint, syntax and
whitespace checks, and the production build also pass. The remote Linux CI result
requires a new pushed revision; rerunning the original commit would still exercise
the old hook.

## iPhone second double-tap follow-up

The user confirmed that photo toggles work and the remaining failure is video on
iPhone Safari. The `efefd4b` CI and deployment succeeded; the reported failure was
therefore a device input behavior that the simulated native API checks did not cover.
The previous touch-WebKit action called `webkitSetPresentationMode('fullscreen')`,
transferring video presentation to Safari's system player. Native video presentation
replaces custom page UI with system controls, as described in the
[Video.js fullscreen guide](https://videojs.org/docs/framework/html/guides/fullscreen#availability-and-constraints).
Simulating touches on the DOM video after that call does not prove that taps in the
real system player reach the webpage. This explains the gap in the previous coverage.

For reliable double-tap entry and exit, touch WebKit now stays in the page-controlled
viewer. The button and gesture still invoke one action. Supported container fullscreen
uses the browser API; otherwise the fallback fills Safari's visible viewport with
`position: fixed`, `inset: 0`, `100vw/100dvh` and top-level stacking. Safari browser
bars may remain visible. Player and file-preview roots portal to the body from their
first render, retaining the same video node, source and playback position. Close,
rotation, native/browser exit, PiP events and natural completion clean up mode styles.
Photo behavior is unchanged in this follow-up.

A separate event-state defect was also reproduced: `webkitbeginfullscreen` changed
the button label while the next toggle still read stale inline properties and requested
entry again. The shared snapshot now remembers native mode events for both the UI and
action, and chooses the matching native exit when no owned container is fullscreen.

New fixtures reject any native video fullscreen call in the iPhone-like touch path.
They exercise three enter/exit cycles, rotation, mixed button/gesture use, unchanged
video identity/playback position, ineffective/rejected container APIs, independent
PiP, Close and natural completion. A delayed container request cannot restore
fullscreen after the second double tap exits; a late entry after Close is also
released. Native API compatibility tests use a non-touch
capability snapshot, and the event-only native case failed before the state fix.

The final gesture suite passed in Chromium, Firefox and WebKit, including delayed
video entry/exit and the existing photo regressions. The video recovery suite also
passed in all three engines. Chromium public-consumption checks passed at desktop,
phone and tablet widths, and file-preview regressions passed all 32 groups across
13 formats. TypeScript, full ESLint, syntax/whitespace checks and the production
build passed. These changes are local and have not been committed or deployed.

Physical iPhone testing remains required after deploying this revision; the local
browser fixtures are not an iPhone system player.
