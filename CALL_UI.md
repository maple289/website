# Messenger call interface

Voice and Video actions use the existing explicit `CallInfo.media` field in call
state and signaling. Voice capture requests audio only. Video calls request
audio and camera; camera off leaves the audio call connected. Incoming dialogs
identify the call type and ring using synthesized Web Audio tones. If autoplay
is blocked, Enable call sound unlocks ringing with a user gesture. Ringing stops
on accept, decline, unavailable invitation, or sign-out; Mute ringing is local.

Normal video calls show the remote participant as the main canvas and a smaller
mirrored self-view in the upper-right corner. The preview can be dragged to
safe corners or moved with its keyboard-accessible corner button. Hide self-view
changes only presentation. Screen previews and remote video are not mirrored.
Voice calls show participant initials/name, duration, microphone and device
controls, and hang-up without a video canvas. Speaker selection is offered when
the browser supports `setSinkId`; system output remains the default.

Expand requests browser fullscreen on the complete call container. A stable
portal to document.body escapes Messenger width and overflow restrictions. A
fixed 100vw by 100dvh fallback handles unavailable/rejected fullscreen. Native
fullscreen changes synchronize the layout; explicit exit restores the floating
panel. Both modes retain the same remote media nodes and engine instance.
Fullscreen keeps controls visible along the bottom and uses object-fit: contain
for remote video. ResizeObserver measures header/control safe areas for preview
positioning, with mobile safe-area padding and smaller previews.

Incoming tasks use TaskModal; fullscreen uses useModalLayer for shared focus,
inertness and scroll locking. Background taps/Escape do not dismiss a CSS
fullscreen task or end a call. Browser-native fullscreen exit changes only the
layout. Ending a fullscreen call also exits fullscreen and releases modal locks.

The existing protocol has no voice-to-video upgrade operation and creates video
transceivers only for video calls. This optional upgrade is not added here;
implementing it requires an explicit shared call-type transition. No changes
were made to CallEngine, signaling RPCs, ICE, TURN credentials or router settings.

## Validation

- `tests/messenger-call-layout.mjs`: actual CallPanel, CallProvider and CallEngine
  with fixture signaling/peers and synthetic media. Desktop, tablet, mobile
  portrait/landscape; native API and CSS fallback; real browser fullscreen on
  desktop; drag/corner controls and orientation changes; mirrored local view;
  hide/show without changing capture/tracks/peers; camera off retains audio;
  voice and incoming video capture constraints; ringtone/autoplay/cleanup;
  fullscreen hang-up cleanup. Run against Chromium and Firefox via the existing
  PLAYWRIGHT_MODULE / BROWSER_TYPE environment options. Screenshots are written
  to the ignored `.runtime/call-layout` folder.
- `tests/messenger-call-ui.mjs`: incoming permission flow over nested task dialogs
  on four responsive profiles, including draft preservation and focus restoration.
- `tests/messenger-call-engine.mjs` and `tests/messenger-call-relay.mjs`: media
  lifecycle, ICE recovery/credential refresh, authentication and TURN authorization.
- TypeScript, changed-file ESLint and Vite production build.

Browser viewport emulation and synthetic media do not establish physical-phone
camera/audio behavior or live P2P/TURN connectivity. Those need a two-device test
after deploying the frontend; this UI change requires no database migration.
