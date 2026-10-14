Superseded by VIDEO_PLAYER_RECOVERY.md. The implementation described below was
replaced after the reported iPhone regression; it is retained as historical context.

iPhone video completion follow-up

Implemented locally; not pushed/deployed by this change.

The original completion hook only recognized document fullscreen and the older
`webkitDisplayingFullscreen` flag. It omitted native presentation-mode fullscreen
and required DOM ended/seeking flags to be updated before accepting completion.
It also discarded a close request after an exit timeout/failure. Those gaps could
leave the native controller open even after the page's player was removed, or
leave the modal open after fullscreen eventually exited.

An isolated UI fixture using the original committed hook reproduced the missing
presentation-mode path: the page player closed while native fullscreen had never
been asked to exit. The corrected implementation passes that same API shape.
This reproduces the code defect with simulated native APIs, not on a physical phone.

`src/lib/videoFullscreen.ts` now detects native presentation mode, requests
`webkitSetPresentationMode('inline')`, supports both legacy exit spellings and
retains standard document fullscreen. It waits for native end/presentation events
or confirmed flag changes, and tries another supported API if an exit rejects
or is ineffective. Exit events take precedence over lagging readonly flags.
Only this player's fullscreen is exited. The bounded API wait never schedules
closure from video duration.

`src/hooks/useVideoCompletion.ts` tracks native fullscreen lifecycle and retains
close intent until exit completes. A real ended event is accepted despite lagging
DOM flags. Native time/fullscreen/foreground events can recover an actual ended
state when native playback defers the DOM event; they do not infer completion
from elapsed time or a position threshold. Direct seeks, pause, buffering,
errors and manual fullscreen exits during playback still leave the player open.
Source changes/unmount abort stale work and remove listeners; shared modal
cleanup restores gallery focus, scrolling and selection.
Completion is latched once per playback, so progress and ended events cannot
duplicate failed exit requests. A deliberate replay resets that completion latch.

The APIs are documented by [Apple](https://developer.apple.com/documentation/webkitjs/htmlvideoelement/1631224-webkitsetpresentationmode)
and the legacy aliases by [WebKit's video element API](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLVideoElement.idl).

Validation:

- `tests/mobile-video-completion.mjs`: real three-second media with simulated
  iPhone fullscreen contracts, in portrait and landscape. Presentation-only,
  legacy alias, stale flags, rejected APIs, late exit, lagging/deferred completion
  and flag-only exit cases pass in Chromium, Firefox and Windows WebKit. The
  cases verify exit before source removal, no duplicate exit requests, scroll
  cleanup, reopening and pause/seek/manual-exit safety.
- Rejected native exits do not loop on subsequent progress/ended events; a later
  exit completes the retained close request. The final guard passes in all three
  engines in portrait and landscape.
- Existing `public-consumption` regressions pass in all three engines, including
  actual Chromium desktop fullscreen and unchanged public card/viewer behavior.
- The original hook fails the presentation-mode regression; corrected code passes.
- ESLint, TypeScript, production compilation and Git whitespace checks pass.

The UI runner includes the new suite by default; the Firefox CI step also runs it.
`MODAL_SAFETY.md` and the rejected-exit regression reflect automatic completion of
the retained close request when fullscreen exits later.

Physical iPhone Safari/Firefox verification remains unavailable in this workspace.
The browser engines and native API/event simulations cannot certify AVKit on the
reported phone. Retest normal and fullscreen playback on that device after deploy.
