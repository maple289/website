# Android normal landscape video fitting

Scope: Android **phone** user agents (`Android` and `Mobile`), coarse pointers,
landscape, gallery normal view. `VideoPlayer.tsx` adds the platform marker;
`AndroidVideoPlayer.css` contains all geometry rules. Existing iPhone CSS and
viewport hook are unchanged. No playback, seeking, gesture, fullscreen or PiP
handlers are modified. Android tablets, portrait and desktop are excluded.

The old normal card had a `95dvh` maximum and `overflow-y:auto`, but its playback
area retained a width-driven 16:9 aspect ratio. At 844×390 the playback area was
810×455.6px, extending below the card (650px of contents in 369px of client height).
The video already used `object-fit:contain`; it correctly fitted an oversized
area, rather than the visible remaining height. The lower frame and controls
were therefore off-screen inside the scrolling/clipped card.

The Android landscape card now has a definite `calc(100dvh - 32px)` height,
accounting for the existing 16px modal padding on each side. A column flex layout
reserves only a bounded 52px scrolling reaction row. The compact title/Close and
presentation buttons overlay the video instead of taking separate flex rows.
Decorative overlay space passes pointer input to the video; actual buttons remain
tappable. The translucent mode bar leaves the native 64px transport strip clear.
The playback area takes the remaining height with zero minimum, automatic aspect
ratio and a positioned video filling that final area. `object-fit:contain` remains
unchanged, with explicit centered positioning and maximum dimensions. This scales
the original frame proportionally, adding black letterboxing as needed. Existing
dynamic viewport units are sufficient; no VisualViewport listener was added.

Every new geometry selector excludes page, standard and WebKit fullscreen.
Native PiP rendering and its API lifecycle are independent of this normal-page
layout. Rotation/media queries recalculate automatically without stored sizes.

`tests/android-video-layout.mjs` checks bounded card geometry and compares decoded
frame pixels with uniform contain scaling, including top/bottom/left/right strips,
at 390/330/260/220px landscape heights. It repeats portrait→landscape rotation,
checks portrait/iPhone/desktop/tablet exclusion by disabling only the new stylesheet,
checks scrolling reactions cannot resize the picture, play/pause/seek, actual
browser fullscreen, CSS fullscreen fallback, mocked native PiP API roundtrip,
reaction add/remove and Close. CI runs Chromium and Firefox. The existing iPhone
layout and hit-testing regressions stay separate and unchanged.

These are desktop-engine Android profiles, not real Android hardware. Physical
Chrome/Firefox, browser chrome, decoder/compositor behavior and OS PiP still need
device validation. Native PiP is mocked because desktop automation cannot verify
the phone's floating system window. No real-device result is claimed.

Local validation passed Chromium/Firefox Android profiles, native and page
fullscreen comparisons, mocked PiP roundtrips, and the unchanged iPhone layout
suites in Chromium/WebKit (Safari/FxiOS/CriOS profiles). Type-check, lint and
production build passed; lint retains its existing vendored warning. The Android
pixel test checks colored corner marker bounds as well as picture/edge regions,
so black letterboxing cannot hide a missing or clipped picture.

The subsequent size correction addresses the rows retained by the first fitting
fix: they took 96px away from the video. At 844px viewport width, playback heights
were 208/148/78/38px for 390/330/260/220px visible landscape heights. Removing those
rows yields 304/244/174/134px while leaving the card height, 52px reaction row and
contain sizing unchanged. The regression test reconstructs the former rows and
checks the size gain, full decoded frame, pointer pass-through and native seek
clearance. Chromium and Firefox Android profiles passed those checks, touch
double-tap fullscreen, native/page fullscreen, PiP API roundtrip, playback/seek,
reactions and Close. Portrait exclusion remained exact. The unchanged WebKit
iPhone layout suite passed Safari, FxiOS and CriOS profiles. Existing graph paths
used: VideoPlayer() → VideoPresentationControls()
→ useVideoPresentation(), VideoPlayer() → MediaReactions(), and VideoPlayer() →
useIPhoneVideoViewport() (reference only). CSS allocation was verified directly;
the existing graph was not regenerated.
