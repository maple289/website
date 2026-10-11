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
implementing it requires an explicit shared call-type transition. SDP/ICE, TURN
credentials and router settings remain unchanged.

Camera availability is explicitly published through the existing authenticated
signaling RPC as `media-state` with cameraState, screenSharing and a monotonically
increasing revision. Only the joined participant's owning browser session may
update it. The latest state is saved on the call member for late joiners and
targeted events notify joined peers. Retries reuse the revision; stale requests,
signals and inbox snapshots cannot overwrite newer state. Screen sharing remains
visible when the camera is off. Failed publication retries during call polling.

Remote and self-view presentation also monitors actual enabled/muted/readyState,
mute/unmute/ended and stream track changes. Unavailable video is immediately
masked with solid black and its image is hidden; the existing element stays
attached for audio and automatic camera resume. A lightweight state check covers
enabled changes and stop() implementations that emit no event. Replacement remote
tracks supersede the old track of the same kind in the displayed stream without
recreating the peer connection. Hide self-view sends no media-state update.

## Validation

Short landscape screens use a compact control row with 44px touch targets and
a self-view sized to the remaining height. The video stage can shrink instead
of forcing the footer beyond the phone screen. Device settings scroll while
the call controls remain pinned. Normal and CSS fullscreen surfaces follow
visualViewport resize/scroll bounds so browser chrome and keyboard space are
respected; pinch zoom is preserved. Native fullscreen retains its own viewport.

- `tests/messenger-call-layout.mjs`: actual CallPanel, CallProvider and CallEngine
  with fixture signaling/peers and synthetic media. Desktop, tablet, mobile
  portrait/landscape, including 568×250, 667×280 and 932×300 short landscape
  viewports; all controls stay inside the panel, including during device-settings
  scrolling; reduced visual viewport bounds and pinch zoom; native API and CSS
  fallback; real browser fullscreen on
  desktop; drag/corner controls and orientation changes; mirrored local view;
  hide/show without changing capture/tracks/peers; camera off retains audio;
  voice and incoming video capture constraints; black video for explicit camera
  off despite a still-live receiver track; mute/unmute/ended/enabled changes;
  automatic resume and replacement tracks; normal/fullscreen black self-view;
  screen-sharing preservation; ringtone/autoplay/cleanup;
  fullscreen hang-up cleanup. Run against Chromium and Firefox via the existing
  PLAYWRIGHT_MODULE / BROWSER_TYPE environment options. Screenshots are written
  to the ignored `.runtime/call-layout` folder.
- `tests/messenger-call-ui.mjs`: incoming permission flow over nested task dialogs
  on four responsive profiles, including draft preservation and focus restoration.
- `tests/messenger-call-engine.mjs` and `tests/messenger-call-relay.mjs`: media
  lifecycle, versioned camera signaling/retries/late joiners, ICE recovery and
  credential refresh, authentication and TURN authorization.
- `tests/messenger-calls.mjs`: applies the real migration in isolated PostgreSQL
  and checks camera-state validation, owning-session authorization, actor scoping,
  revision ordering, expiry persistence and the existing call/permission flows.
- TypeScript, changed-file ESLint and Vite production build.

Browser viewport emulation and synthetic media do not establish physical-phone
camera/audio behavior or live P2P/TURN connectivity. Those need a two-device test
after deployment. Apply `20261011010000_messenger_camera_state.sql` before deploying
the frontend so the new media-state action and persisted member fields exist.
