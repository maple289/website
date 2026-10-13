# Mobile fullscreen and PiP controls

## Findings

The gallery and video-file players previously rendered `<video controls>` with
no application fullscreen or PiP entry handlers. Searching the playback code found
no deferred `requestFullscreen`, shared entry effect, or incorrectly wired custom
button. The fullscreen hook in Messenger belongs to a separate call player.

Confirmed application gaps were reliance on native entry controls, absence of
independent mode state/feature detection, missing sizing for a complete fullscreen
player surface, and close cleanup that handled fullscreen but omitted PiP. The exact
reported iPhone native-control gesture sequence cannot be established without the
physical device. Lost activation in an application handler is not a confirmed root
cause, because those handlers did not previously exist.

## Implementation

- `src/hooks/useVideoPresentation.ts`: synchronous fullscreen/PiP requests from
  separate tap handlers; no entry effect, timeout, asynchronous fallback or queued
  action. Browser/native events and properties determine mode state. Each operation
  has its own pending guard; later promises cannot clear a newer operation. Standard
  container fullscreen is preferred when supported/enabled, with feature-detected
  WebKit container and native video API fallbacks, including legacy aliases.
  Native fullscreen and PiP controls require loaded metadata, preventing early
  invalid media requests; loading metadata itself never requests a mode.
- `src/components/VideoPresentationControls.tsx` and its stylesheet: one inline
  control bar with play/pause, seeking, mute and desktop volume. Fullscreen and PiP
  are independent buttons. Unsupported modes are omitted; conflicting modes require
  an explicit exit first. Native video fullscreen retains system controls. Mode and
  playback failures show concise messages; development logs contain actual errors.
- `src/components/VideoPlayer.tsx` and `src/components/FilePreview.tsx`: reuse the
  same controls, fullscreen the complete player surface and preserve TaskModal.
  Fullscreen layout fills the viewport with an unconstrained playback area and
  `object-fit: contain`; header, Close and application controls remain accessible
  in container fullscreen. Rotation follows viewport units automatically.
- `src/lib/videoFullscreen.ts` and `src/hooks/useVideoCompletion.ts`: wait for an
  entry already in flight, then exit only this player's fullscreen/PiP before
  removing its media source. Natural end and manual close share this cleanup.
  Rejected exits retain the video/modal; a subsequent browser exit completes the
  close. Native recovery checks actual ended state, including PiP, without a
  playback-duration timer. Cleanup attempt deadlines bound failed exits only;
  they never retry an entry on another gesture.
- Tests: `tests/video-presentation.mjs`, the video-file HTML/React fixture,
  updated public-consumption assertion, runner registration and Firefox CI coverage.
  Modal behavior is recorded in `MODAL_SAFETY.md`.

Backend authorization, public/private media access and context-menu permissions
are unchanged. No management actions or unauthenticated downloads were added.

## Validation

Final checks passed as shown below. The suite exercises repeated
fullscreen/exit/fullscreen/exit/PiP/exit/fullscreen/exit; synchronous user activation;
rejected entry followed by PiP without replaying fullscreen; rejected exits;
system exit; pause/seek/stall; portrait/landscape viewport changes; closing during
entry; natural end in fullscreen/PiP; deferred native ended notification; source,
scroll, focus and inertness cleanup; reopening; and the actual FilePreview component
under StrictMode. API simulations are explicitly distinguished from real fullscreen.

| Check | Chromium | Firefox | Windows WebKit |
| --- | --- | --- | --- |
| Phone/tablet controls; three repeated transition sequences; native/standard API simulations | Passed | Passed | Passed |
| No requests before metadata; first eligible tap; independent fullscreen/PiP | Passed | Passed | Passed |
| Gallery playback/end, pause/seek/stall, public menus and previews | Passed | Passed | Passed |
| Native begin/end, presentation, stale flags, rejected/late/flag-only exits | Passed | Passed | Passed |
| Real desktop container fullscreen, viewport sizing, exit/re-entry, natural end | Passed | Passed | Not tested |
| Real video-file Blob playback, StrictMode, fullscreen manual close and PiP end | Passed | Passed | Runtime limitation; unsupported fallback/close passed |

The existing file-preview suite passed 32 groups in Edge across desktop, tablet,
portrait and landscape, including public/private views and 13 supported formats.
Whole-repository ESLint, TypeScript, `git diff --check` and the production build
passed. Build output is `.runtime/video-controls-build`. Representative phone and
desktop fullscreen screenshots were inspected. CI runs the new suite in Chromium
and Firefox, including the readiness checks.

## Platform limits

Physical Android Chrome/Firefox, iPhone Safari/Firefox and iPad Safari were not
available. Chromium/Firefox/WebKit browser-engine tests and native API simulations
are not physical-device certification. iPhone native fullscreen presents system
controls rather than the complete HTML player. PiP is omitted where no supported
web API is exposed; Firefox may still provide its own browser/system PiP feature.
Touch devices use hardware volume controls; mute is provided in the control bar.

Windows WebKit rejects the fixture MP4 through a Blob URL with media error code 4,
while the identical bytes load successfully over HTTP. A separate raw-video probe
confirmed this with both native controls and no controls, independently of the
application. The file test checks that limitation before accepting its unsupported
fallback; it does not claim successful file-video playback on this runtime.
Evidence is saved in `.runtime/webkit-blob-validation.json`. The production Blob
loading path was preserved. [Playwright documents OS-dependent media support](https://playwright.dev/docs/browsers#webkit);
this result does not establish how physical iPhone/iPad Safari handles that source.

The fallback follows [Apple's native presentation APIs](https://developer.apple.com/documentation/webkitjs/adding_picture_in_picture_to_your_safari_media_controls).
Direct entry preserves the activation required by
[Fullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen)
and [PiP](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestPictureInPicture).
[Selective native control hiding has limited availability](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/controlsList),
so the inline player does not rely on that feature to remove duplicate buttons.

Changes are local; no push or production deployment has been performed.
