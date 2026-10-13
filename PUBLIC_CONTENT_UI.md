Public content consumption UI — 2026-10-13

Implemented locally. This change has not been pushed or deployed. The earlier
public-preview repair is already deployed; anonymous video/photo image requests
were verified as HTTP 200 with image/webp content and no redirects.

Anonymous video, photo and file cards have no three-dot menu or application
context menu. Public files also hide selection/bulk-download controls and preview
download buttons. Supported files open directly by mouse, touch or keyboard;
unsupported files retain the existing file-type icon without a management dialog.
Photos still open their viewer and videos still open their player.

Signed-in owners retain the existing management actions. Other authorized readers
retain permitted preview/play and download actions. Unavailable playback,
temporary-link and Paste actions are omitted, and empty menus are hidden. Public
Files retains its existing read-only catalog scope even for signed-in visitors;
owner management remains in My Files. Logout immediately removes an open menu
and clears account-dependent file selection/details. Backend handlers, mutation
permissions and RLS are unchanged; existing authorization regressions passed.

Playback closes through the media element's actual `ended` event, checking its
ended/seeking/loop state and suppressing direct seeks to the end. Pause,
buffering, stalls and errors do not trigger closure. The same completion hook
serves the video gallery and video-file previews. Manual Close uses the same
cleanup. No playback-duration timer or page reload is used.

The close path pauses playback, awaits fullscreen exit for this player, releases
the source and closes the parent selection. Standard, vendor and native Safari
fullscreen APIs/events are handled. A bounded fullscreen-exit wait protects
against an unavailable/stalled API; exit failures retain the visible modal and
allow explicit retry. Source changes/unmount abort stale callbacks, remove
listeners and release media. TaskModal retains focus, inertness, scroll locking
and gallery-position restoration. Inline playback is enabled on mobile.

Changed application components:

- `src/components/MediaContentMenu.tsx`: anonymous gating and available actions.
- `src/components/ContentContextMenu.tsx`: hide/reset empty menus.
- `src/components/FileManager.tsx`: public consumption controls, icon fallback,
  keyboard opening, auth-transition cleanup and guarded context actions.
- `src/components/FilePreview.tsx`: optional download controls, consumption-only
  messages, inline playback and shared completion cleanup.
- `src/components/PdfFilePreview.tsx`: omit download suggestions in public mode.
- `src/components/VideoPlayer.tsx`: completion/close lifecycle and mobile controls.
- `src/hooks/useVideoCompletion.ts`: ended listeners and fullscreen/source cleanup.

Validation:

- Chromium, Firefox and Windows WebKit public consumption checks passed at
  1440px desktop, 390px phone and 768px tablet widths.
- Actual Chromium desktop fullscreen ended/exit/close passed. Asynchronous
  standard and simulated native Safari exits, rejected exits and retry passed
  in all three engines.
- Natural playback, pause/stall/error/seek safety, source release, scroll/focus
  restoration, manual close, reopening, anonymous menus, public photo/generated
  file previews, keyboard opening, owner/read-only actions and logout passed.
- Chromium/Firefox public-preview refresh, failed-image recovery, repeated auth
  transitions, private hiding and image reuse passed.
- Signed-in context-action/deletion-confirmation checks passed (14 groups).
- All 13 file-preview formats passed in private/public modes on desktop, tablet,
  portrait and landscape layouts (32 groups).
- Core/backend security regressions, ESLint, TypeScript and production build
  passed. The build retains its existing large-chunk advisory.

`tests/public-consumption.mjs`, its small codec fixtures, the shared public fixture
server/harness and affected existing UI tests provide regression coverage.
`scripts/run-ui-regressions.mjs` runs the new suite by default; CI also runs it in
Firefox. `MODAL_SAFETY.md` documents the completion exception and cleanup.

Browser limitations: these are browser-engine and responsive/touch-emulation
checks, not physical Android, iPhone/Safari or tablet tests. Native iOS fullscreen
was simulated. Windows WebKit uses H.264 for real playback because its VP8
decoder cannot play the fixture; its native context menu is tested by dispatching
the application event because the OS popup consumes automation clicks. Native
browser save/download controls remain browser-dependent; public media remains
readable, while application management controls are hidden.
