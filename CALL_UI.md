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
controls, and hang-up without a video canvas.

Audio output is managed separately from WebRTC by `CallAudioOutput`, per active
call/account. Mobile identity uses platform/user-agent evidence, never screen
width. The explicit `CallInfo.media` type prefers a uniquely labelled earpiece
for voice or built-in loudspeaker for video, for outgoing and accepted calls.
Device IDs come from live enumeration or a user-activated `selectAudioOutput`
picker. There is no standard physical output-role property: unlabeled, ambiguous
and unrecognized outputs keep system routing. Desktop starts on system output.
Bluetooth, wired/USB/headset input or output, and unidentified audio devices prevent
automatic phone-output overrides. Connecting an accessory after an automatic
preference restores system routing; manual choices persist until unavailable.

The mobile Speaker button shows Speaker on/highlighted only for a confirmed
loudspeaker, Speaker off only for a confirmed earpiece, and a neutral Speaker
button with system/headset/unknown status otherwise. With an exposed receiver
and speaker pair it toggles; otherwise it opens output options and guidance.
Every remote media element and later participant receives the chosen sink.
Selection resolves and sinkId is checked before showing success. Group failures
roll back successful elements; device loss falls back once, and failed automatic
choices do not repeatedly retry. Slow browser responses are serialized and late
responses restore the current choice. Playback is only briefly deferred for
initial routing; slow/unsupported output APIs never stop capture or the call.
Fullscreen, orientation, camera state and preview visibility preserve the route.

Support must be feature-detected in secure contexts and remains permission-bound.
Current [MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/HTMLMediaElement.json)
reports no setSinkId in Android Chrome/Firefox and support in Safari 18.4+, which
does not establish that separate receiver/speaker outputs are exposed. The
[output picker](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/selectAudioOutput)
also varies by browser. Unsupported/indistinguishable physical routes are left
to the OS/browser; the UI never represents system-default output as earpiece or
speakerphone. No native audio-session hacks, TURN or signaling changes are used.

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
- `tests/messenger-call-audio-output.mjs`: browser-output policy, readback,
  permission denial, picker cancellation/enumeration races, group rollback,
  headset preservation/hotplug, device loss, delayed response and request guards.
- `tests/messenger-call-audio-ui.mjs`: actual call UI/provider/engine with output
  API fixtures; outgoing/accepted voice/video preferences, confirmed Speaker
  states, unsupported Android/iPhone fallback, wired/Bluetooth/USB, desktop
  selection, rotation/fullscreen and unchanged captures/tracks/peer connections.
  Run in installed Edge/Chrome and Firefox with the existing browser options.
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

Physical audio-routing acceptance remains to be checked on Android Chrome and
iPhone Safari, with and without Bluetooth/wired headsets: verify audible receiver
vs loudspeaker for outgoing and accepted calls where distinct outputs exist;
verify OS-controlled audio and neutral UI when they do not; verify Speaker
switches back only after confirmed selection and does not interrupt the call.
Desktop browser/output tests use API fixtures, not physical output hardware.
