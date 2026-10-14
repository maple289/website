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
  Capability detection, native WebKit entry/exit and PiP behavior remain in that
  existing function. Gesture entry executes directly in the second touchend.
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
the real Safari retest must verify gesture delivery while the system video player
is fullscreen; a mocked WebKit API cannot verify that input path. Remote Linux CI
and deployed-device results are separate checks.
