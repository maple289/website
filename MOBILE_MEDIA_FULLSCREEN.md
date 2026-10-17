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

## Superseded mobile Fullscreen button size follow-up

The user's landscape screenshot shows the application's Fullscreen entry button
inside the normal bordered card. Local iPhone-sized WebKit reproduced the apparent
size reversal: at 844x390, the normal card was capped at 370.5px high while its
width-driven 16:9 video stage remained 455.6px high. The header, controls and reactions
added further height, so the card scrolled and clipped its contents. The fullscreen
layout correctly fitted the video between the header and controls at 262px high,
which looked smaller than the overflowing normal video. Opening did not set a
fullscreen mode, and the button's enter/exit state was correct.

Coarse-pointer gallery players now use a bounded column layout in normal mode.
The stage and video can shrink together while the header, presentation controls and
reactions retain their space. Explicit flex sizing also avoids WebKit retaining a
percentage video height from the stage's original aspect-ratio size. The complete
video remains contained. At 844x390, normal video height is now 174px, fullscreen
increases it to 262px, and exit restores 174px. The same fullscreen action and state
remain in use; file-preview and desktop layouts are unchanged.

The gesture suite adds initial normal-state, no-overflow, control hit-testing,
fullscreen enlargement and restored-size assertions at 390x844, 844x390, 932x430,
844x320, 768x1024 and 1024x768. Both button exit and double-tap exit are exercised.
These are local browser-engine checks; physical iPhone Safari remains unavailable.

The complete media gesture suite passes in WebKit, Chromium and Firefox, including
all six new size cases. Chromium's real touch/Fullscreen API checks and Chromium/
Firefox desktop double-click checks also pass. TypeScript, full ESLint, JavaScript
syntax/whitespace checks and the production build pass. The layout correction is
local and has not been committed or deployed.

## Restore the large mobile presentation

The user rejected the preceding sizing change: reducing the normal picture did
not solve the small fullscreen picture. The coarse-pointer normal-size restriction
has been removed, restoring the previous width-driven 16:9 normal player.

Mobile gallery fullscreen now gives both the playback area and video the entire
viewport. The header and application controls overlay that picture instead of
subtracting separate rows from its height. Close and Exit fullscreen stay accessible;
the application bar sits above the native playback-control strip. At 844x390,
fullscreen video height is now 390px rather than 262px. The complete source remains
contain-fitted, without distortion or cropping. Safe-area spacing applies to the
overlaid application controls. The same fullscreen state/action still controls the
button and double tap; desktop and file-preview layouts are unchanged.

The size regression now checks the restored normal dimensions, actual viewport-sized
fullscreen media and accessible overlay controls. Button exit and double-tap exit
must both restore the earlier normal size. This replaces the rejected requirement
that normal media shrink to accommodate separate rows in landscape.

The full media gesture suite passes in WebKit, Chromium and Firefox, including the
six phone/tablet sizes, repeated button/gesture toggles, PiP, Close and photo
regressions. Real Chromium touch/Fullscreen API and Chromium/Firefox desktop
checks pass. TypeScript, full ESLint, syntax/whitespace checks and the production
build pass. Screenshots confirm the fullscreen video uses the full viewport and
the overlay controls remain usable. The correction is local and has not been
committed or deployed; physical iPhone Safari verification is still required.

## Touch-to-reveal controls and fullscreen fill

The user approved hiding the application bar during playback and filling unused
black margins, with edge cropping where the source and screen proportions differ.
The fullscreen stage/video geometry already matches the viewport and has no left
offset in the source or local browser checks. Its previous `object-fit: contain`
can leave margins. The screenshot alone cannot establish whether its one-sided
black region is also present in the original video.

That revision used centered `object-fit: cover` in mobile gallery fullscreen. It
filled the viewport without stretching, cropping excess source edges symmetrically.
Normal gallery playback, desktop fullscreen, photos and file previews kept their
previous fit behavior. No separate fullscreen mode/action was added.

The application bar hides after two idle seconds while playing in mobile gallery
fullscreen. Touch reveals it without consuming video gestures or native playback
controls. Pause, seeking, buffering and errors show it; keyboard focus keeps it
usable. Hidden controls are inert and excluded from accessibility/focus navigation;
keyboard input reveals them before the modal layer handles navigation. Close remains
visible. Exit, source replacement and unmount restore visibility and clear listeners
and timers. Photo navigation and site-wide zoom behavior are unchanged.

A real Chromium touch test reproduced an important reveal hazard: the browser can
retarget a touch's synthetic click to an Exit button newly revealed under the finger.
A capture guard now suppresses that one control click; a subsequent deliberate touch
can use the button. The test failed before the guard and passes with it. Regression
coverage also includes idle hiding, pause/keyboard visibility, hidden-bar double-tap
exit, cleanup/reopen, viewport fill and existing presentation/gesture behavior.

A generated 45-second blue clip, in MP4 and WebM variants, gives the idle-control
tests uninterrupted playback. The short completion fixture can pause at its loop
boundary in Windows WebKit and is retained for completion-specific regressions.

The complete media gesture suite passes in Chromium, WebKit and Firefox, including
the new visibility/fill checks and existing photo, fullscreen, PiP and desktop cases.
The Chromium player-recovery suite also passes. TypeScript, full ESLint, JavaScript
syntax/whitespace checks and the production build pass. Local screenshots show
edge-to-edge video with the application bar hidden during playback. These changes
are local and have not been committed or deployed. Physical iPhone Safari input
and the original clip's black region still require deployed-device verification.

## Follow-up: the control bar reappears and stays visible

A reproduced cause matches the user's symptom. The hook treated both `waiting`
and `stalled` as buffering, revealed the bar and latched `buffering = true`. Only
`playing` cleared that flag. A [stalled event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/stalled_event)
reports missing downloaded data, while already buffered video can continue playing.
Without another `playing` event, the flag prevented every subsequent hide attempt.
The physical iPhone event sequence was not recorded; this is a verified code defect
and local reproduction, rather than a captured device trace.

Visibility now follows current paused/ended/seeking/error/readiness state. Advisory
media events preserve an already hidden bar. `canplay`, `progress` and `timeupdate`
can restart auto-hide when future frames become available, without requiring a new
`playing` event. Continuous progress does not reset an existing two-second idle
deadline. A fired timer clears its handle so later recovery can schedule another.
Explicit touch/keyboard actions still reveal controls, and actual pause/buffering
and keyboard focus retain accessibility. Fullscreen, fill sizing and gestures are
unchanged.

The new regression dispatches `stalled` during buffered real playback and failed
before the fix because the hidden bar became visible. It also checks background
progress/late playing events, genuine low-readiness waiting, and recovery through
`timeupdate` without another playing event. Existing real-touch, focus, paused-bar,
fullscreen/PiP, cleanup and photo tests remain in the same suite.

The complete media suite passes in Chromium, WebKit and Firefox, and Chromium's
player-recovery suite passes. TypeScript, full ESLint, JavaScript syntax/whitespace
checks and the production build pass. This correction is local and uncommitted;
physical iPhone Safari verification is still required after deployment.

## Follow-up: show the complete iPhone fullscreen video frame

The mobile fullscreen rule introduced for edge-to-edge fill used
`object-fit: cover`, overriding the player's normal `contain` fit. That enlarges
the picture until it fills both viewport dimensions and crops source edges when screen and
video proportions differ. This matches the reported cutoff. The fullscreen stage
itself already fills the viewport; reducing its dimensions is unnecessary.

Mobile fullscreen now uses centered `object-fit: contain`, showing the largest
complete frame that fits without distortion or cropping. Black bars are expected
when source and screen proportions differ. The viewport-sized stage, overlaid
controls, auto-hide, shared button/double-tap action and PiP handling are retained.

The existing mobile layout regression now requires contain-fit sizing for all six
phone/tablet viewports and iPhone fallback/rotation cases. It failed in Windows
WebKit before the CSS correction (`cover` versus `contain`). Standard container
fullscreen coverage also requires the complete frame.

The iPhone fixture also establishes a position through normal playback of the
longer clip, then pauses before comparing position across fullscreen toggles.
Concurrent WebKit runs failed the old artificial-seek threshold, including during
setup before fullscreen entry. Isolated diagnostics retained the same paused
video/source and a stable position. Removing that unrelated seek avoids coupling
fullscreen to decoder seeking; assertions now check paused state and unchanged
position across toggles. Reopening retains the short natural-completion fixture.

Local Windows validation passed the complete media gesture suite in WebKit,
Chromium and Firefox (75 groups), plus actual Chromium/Firefox container
fullscreen recovery checks. Portrait/landscape WebKit screenshots show centered,
contained video. TypeScript, full ESLint, JavaScript syntax, whitespace validation
and the production build passed. These are engine fixtures with simulated iPhone
APIs, not physical Safari verification. The fix is local and has not been deployed.

## iPhone Firefox Mobile Site viewport follow-up

The reported case is Firefox on iPhone in Mobile Site mode: a left black strip,
displacement and clipping in fullscreen. The earlier desktop-only compatibility
helper investigation does not explain that mode, and no desktop presentation API
change is included.

The deployed CSS already uses `object-fit: contain`. A mobile viewport regression
reproduces a separate layout defect: when the browser's visible viewport is narrower
or offset from the layout viewport, `100vw`/`100dvh` still size the page fallback to
the larger area. Contain fitting within that frame does not keep the entire frame
inside the visible area. This is a modeled reproduction; the physical Firefox
viewport measurements and exact cause of the user's screenshot are unverified.
See [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
for the layout/visible viewport distinction.

Only the coarse-pointer page fullscreen fallback now tracks visible width, height,
left and top. Resize, viewport scroll and orientation events update its geometry,
batched into an animation frame. Real element fullscreen retains browser sizing.
The same video/source, shared action/state, contain fitting and controls remain.
Pinch zoom does not trigger compensating resize/repositioning. Exit, Close, PiP,
source cleanup and natural completion remove listeners and inline overrides.
Fine-pointer desktop layout and desktop fullscreen actions are unchanged.

The regression covers an offset landscape viewport, changing browser chrome,
portrait rotation, pinch zoom, exit, reentry and Close. It failed before the change
and passed in all three engines after the change. Existing rotation assertions
wait for the scheduled viewport geometry update instead of sampling mid-frame;
no fixed delay is added.

Validation: 78 gesture groups and 131 player recovery checks passed across
Chromium, Firefox and WebKit, including actual desktop fullscreen/button/double-click
checks in Chromium and Firefox. Separate WebKit probes verified fine-pointer
desktop exclusion and removal of overrides when real element fullscreen takes over;
a mobile screenshot showed centered contain-fit video. TypeScript, full ESLint,
JavaScript syntax, whitespace checks and the production build passed. The tests
use local media and simulated mobile viewport/native API behavior. Physical iPhone
Firefox verification is still required after deployment. Changes are local and
have not been deployed.

## Native Pause/skip menu idle follow-up

The user confirmed fullscreen sizing works, then reported that the native
Pause / 10-second skip overlay sometimes remains visible. The application's
`useVideoControlsAutoHide` only hid the Fullscreen/PiP bar; it never governed the
native menu. A focused WebKit regression failed because `video.controls` stayed
enabled after the idle deadline. WebKit's separate
[AutoHideController](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/modern-media-controls/controls/auto-hide-controller.js)
tracks pointers/hover and secondary UI when deciding whether to fade. The physical
iPhone's specific reason for retaining its overlay cannot be inspected here.

The same two-second idle action now temporarily sets `video.controls = false`
only in the coarse-pointer gallery page fullscreen fallback. Existing reveal and
cleanup paths restore the same native controls on touch, pause, seek, buffering,
keyboard use, exit and Close. The video and source stay mounted; fullscreen sizing,
presentation APIs, normal playback UI and desktop behavior are retained. Keyboard
focus within native playback controls prevents hiding. The first revealing touch
is guarded from activating a newly exposed native playback button.
If a delayed container fullscreen request succeeds after idle hiding, fullscreen
events immediately restore browser ownership of native controls.

Regression coverage includes idle native visibility, real forward/backward seeks,
restored controls during pause/buffering/keyboard use, touch reveal, unchanged
video/source/playback and restoration on exit. Skip tests reveal the menu first,
matching the actual touch sequence instead of relying on observing a transient
buffered-seek state. A delayed container takeover is also covered.

Validation: 81 gesture groups passed across Chromium, Firefox and WebKit, including
native visibility, real seek completion, touch/keyboard access, container handoff,
rotation, shared fullscreen actions and desktop regressions. The player recovery
suites also passed (131 checks). WebKit's idle screenshot shows native playback
controls and the application bar hidden while the centered video continues.
TypeScript, full ESLint, JavaScript syntax, whitespace checks and production build
passed. These use isolated local media and simulated mobile APIs. Physical iPhone
verification remains necessary after deployment. Changes are local, not deployed.

## CI follow-up for c65ae82: WebKit readiness after seeking

[CI run 38983068656](https://github.com/maple289/website/actions/runs/38983068656/job/117248158972)
failed in the WebKit controls test after its first 10-second seek. The log reports
`paused: false`, `seeking: false`, `readyState: 2`, and playback time advancing
from about 10.90 to 15.44 seconds. The hide predicate required `HAVE_FUTURE_DATA`
(3), so it could never hide the controls in that recovered state. Chromium,
Firefox and the preceding WebKit player recovery checks passed in the same run.

Mobile gallery fullscreen now checks playback-clock progress when readiness is
only `HAVE_CURRENT_DATA`. A 250-ms probe provides evidence that expires after one
second without movement. It leaves the existing two-second idle deadline intact.
Seek, waiting, pause, end, error and emptied events invalidate earlier progress;
a seek jump alone does not qualify as sustained playback. Genuine stopped-clock
buffering restores controls. Healthy readiness bypasses the probe; exit, source
changes and unmount cancel it. Fullscreen sizing and desktop controls are unchanged.

A local WebKit regression modeling the reported readiness state failed before
the change and passed afterward. It covers continuous motion, an unannounced
clock stall, a non-progressing seek jump, recovery and Close. The pre-existing
buffering fixture now freezes its observed clock as well as readiness, accurately
distinguishing genuine buffering from the advancing-clock CI condition.

Local validation passed: 84 gesture groups and 131 player recovery checks across
Chromium, Firefox and WebKit, plus TypeScript, full ESLint, JavaScript syntax,
whitespace checks and the production build. These are Windows engine fixtures
with simulated mobile/native APIs. Hosted Linux CI and physical iPhone behavior
are separate verification steps.
