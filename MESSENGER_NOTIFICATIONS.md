# Messenger notifications

Notification delivery extends the existing Supabase Messenger broadcasts and
database-backed call state. It does not change WebRTC, TURN, signaling, the video
players, fullscreen, PiP, message read receipts, or unread calculations.

## Delivery

1. Message inserts and call invitation/state changes enqueue text-free events in
   the same database transaction. Call timeline messages do not enqueue a second
   message alert. Events have unique IDs and recipient-specific keys.
2. An awake page first acquires a five-second per-device delivery lease, delivers
   the alert through the service worker, then acknowledges it. The dispatcher
   gives pages a three-second initial grace. If a page is suspended before its
   acknowledgement, its lease expires and push takes over. A provider-owned event
   cannot also produce a foreground card through the page feed.
3. `push-dispatcher` claims a leased delivery for each enabled recipient device.
   It rechecks current account/session, membership, mute/block settings, message
   visibility/read state, preferences, and active call invitation before sending.
4. The worker uses RFC 8291 `aes128gcm` Web Push and VAPID authentication through
   pywebpush. Only standard push-provider HTTPS endpoints are accepted; redirects
   and environment proxies are disabled. No call signaling or auth tokens enter
   a push payload. 404/410 removes only the expired device subscription. Other
   failures retry with bounded backoff within the event lifetime.
5. For page-claimed deliveries the service worker sends an alert to a focused,
   visible application window.
   The page shows a compact rounded card, or suppresses a message alert when that
   exact conversation is already open. Other windows/background delivery use the
   normal OS notification after explicit permission and device enrollment.
6. Every actual Web Push displays a native notification, including when a page
   becomes active during transit. Safari requires this; silently consuming a
   delivered push can revoke its subscription. Server leases prevent the usual
   foreground/push duplication before sending. A shared IndexedDB transaction
   claims each page event once across tabs; repeated pushes quietly replace the
   same OS tag instead of making duplicate entries or sounds. Messages group by
   conversation; calls group by call ID. The
   page feed reacts to the existing Messenger revision and reconnect/focus, with
   a ten-second fallback poll. Web Push does not require this connection or poll.
7. Notification clicks focus an existing application window and use its router,
   or open one window when none exists. Routes contain validated internal IDs.
   Authentication and existing conversation/call authorization still apply. A
   sign-in destination is retained when necessary. Clicking a call never answers
   it: the existing incoming-call interface is opened for an explicit Answer.

Foreground call cards use the existing CallEngine accept/decline methods and one
existing ringtone hook. The full incoming-call TaskModal remains available by
opening the card or system notification. TaskModal retains focus, inertness,
pending guards, and outside/Escape protection. The active call interface is
unchanged. Only the focused page rings; background notification sound belongs to
the OS. A short foreground message tone is used only after a permitted gesture,
when its AudioContext is running and sound is enabled.
Muted-call suppression uses the server's complete authenticated mute list as
well as realtime inbox updates; it does not depend on inbox pagination.

## Storage and authorization

Migration: `20261017010000_messenger_notifications.sql`.

| Table | Purpose |
| --- | --- |
| `messenger_notification_preferences` | Authenticated user's message, voice, video, preview and sound preferences |
| `messenger_push_subscriptions` | Multiple devices per user; provider endpoint, encryption keys, enabled flag, auth session association and timestamps |
| `messenger_push_config` | Public VAPID key and worker heartbeat only |
| `messenger_notification_events` | Recipient, event ID/sequence, content/call references and expiry; no copied message bodies |
| `messenger_push_deliveries` | Per-device page/push lease, retry count/backoff, delivery timestamp and completion |

All five tables have RLS and deny direct anonymous/authenticated access.
`messenger_notifications_rpc` requires an active authenticated account and derives
ownership from `auth.uid()`. It exposes settings/preferences, subscribe,
device/disable, delivery-claim/ack, and the current user's event feed. It never accepts a trusted
frontend user ID. Endpoint ownership cannot be transferred to a different user.
`messenger_push_worker` and payload helpers are service-role-only. Requests use
the existing bearer-authenticated RPC transport rather than cookie auth; another
site cannot submit an authenticated cross-site form to these actions.

Notification display never invokes read/delivered mutations. Clearing a toast or
OS notification never deletes messages or declines a call. Automatic cleanup
retains seven days of expired event metadata and removes expired/old disabled
subscriptions only; uploaded content and conversations are untouched.

## Settings, permission and logout

Settings → Notifications has per-user toggles and one explicit Enable
Notifications action for this device. Loading the page/registering a worker
does not ask permission. A denied state explains browser/device settings without
repeated requests. Device disabling is a reversible preference, not content
deletion. Preference-save failures leave the previous checkbox values intact.

The browser stores only an account/device binding, preferences, and deduplication
metadata in IndexedDB, never a session token. Sign-out clears its binding and
notifications and attempts authenticated device revocation using the captured
session. Global auth-session revocation is also checked by the dispatcher.
Switching accounts does not transfer the old PushSubscription; the new account
must explicitly enable a fresh subscription.

## Service worker and PWA

`public/notifications-sw.js` is a classic service worker (including Firefox
compatibility), sharing `notification-core.js` with the page. It handles push,
page delivery and notification clicks. There is deliberately no fetch handler,
offline app-shell cache, media interception, or cache migration. Existing Caddy
no-cache behavior applies to worker/manifest files.

The relative manifest and existing-logo PNG icons support root and `/video/`
deployments. PWA installation is optional for normal website use. On iPhone/iPad,
Web Push requires iOS/iPadOS 16.4+ and a Home Screen web app. Open the installed
app and press Enable Notifications there. An ordinary iPhone browser tab cannot
promise closed-browser push delivery. Capability detection and an install hint
are displayed; permission is never forced. See WebKit's platform requirements:
https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ .

## Deployment and key recovery

The deployment script builds/starts the isolated unprivileged push worker after
applying the migration. Its VAPID key is generated once in the private `push_keys`
Docker volume; only the derived public key is published to the authenticated
settings action. No new frontend secret or manual private-key configuration is
required. `VAPID_SUBJECT` optionally changes the public VAPID contact URL.

The full encrypted backup includes the signing key from this volume in its
protected temporary spool. Restore the key into that volume with UID 10001 and
mode 0600 before starting the worker after disaster recovery. Keep this backup
private. Removing/rotating the key requires users to re-enable their devices.
Database-only backups do not contain the private volume key.

## Verification and limits

Local verification on Windows (2026-10-18): type-check, ESLint and production
build passed; eight PostgreSQL notification groups, nine service-worker groups,
and five Python encryption/dispatcher tests passed. Notification browser tests
passed in Windows Edge (10 groups, `/video/`), Firefox (10 groups, root path), and
Windows WebKit (9 groups, `/video/`; Push API unsupported in that runtime).
Existing core Messenger/call/relay/audio/security tests, mobile authentication
(18 cases), call layouts/audio, and iPhone/Android/desktop media gesture/player
regressions also passed. Device profiles in automation are emulation, not actual
iPhone/Android OS push delivery. CI additionally validates the Linux Docker image
and Compose configuration before the existing production deployment.

- PostgreSQL/PGlite applies the actual Messenger, call, and new migrations and
  exercises authenticated/anonymous/outsider access, subscription ownership,
  provider URL validation, preferences, multi-device leases, expired devices,
  revoked sessions, mute/block/read-state changes, call answers/timeouts and
  preservation of users/message history.
- Actual service-worker handlers are exercised for background OS calls, safe
  click routing/focus, malformed/logged-out payloads, deduplication, privacy,
  call closure and close-before-invite arrival order.
- Python tests exercise the real Web Push encryption/signing library with a
  receiver-side decrypt round trip, provider error classification, TTL, endpoint
  restrictions, redirect rejection and persistent key generation. No provider
  request or real device enrollment is made by these tests.
- Browser fixtures use a real loopback backend, SW registration and IndexedDB,
  with simulated permission/enrollment. They exercise desktop/tablet/phone cards,
  grouping, conversation suppression, routing, two tabs, denied permission,
  preference failures, voice/video incoming cards and full-dialog safety.
- Existing message/call engine, relay, audio, authentication and media regression
  suites remain required. CI includes the new SQL, worker, browser, Docker and
  Compose checks.

Automated engine tests do not replace physical Windows/Android/iPhone push
delivery tests with real permission, installed PWA, OS notification settings and
two authenticated accounts. Browser suspension/force-quit, battery policies,
Focus/Do Not Disturb, and the OS control delivery/sound/display. iOS web push is
not a native CallKit/VoIP wakeup service. Answering still requires the page and
the existing microphone/camera permission flow.

Call invitations expire after the existing 45 seconds. An awake page closes
obsolete call notifications. For devices sent an invitation push, a terminal
push quietly replaces the same notification tag with "Call no longer ringing".
It must remain user-visible, rather than being a silent close-only push. Expired
or reordered invitations also display this terminal status. Foreground-only or
cancelled-before-delivery calls do not generate terminal pushes. An awake-worker
expiry timer is best effort. A sleeping/offline OS can retain an old alert or delay its
cleanup; web APIs cannot guarantee remote removal or a wakeup at an exact time.
The page always rechecks the existing authenticated call state and cannot answer
an ended call. A stale call link displays its unavailable state. A provider
request already accepted cannot be recalled if preferences change or a lease ACK
is lost in transit; the worker uses private/quiet updates for those races.
See [WebKit's user-visible push requirement](https://webkit.org/blog/12945/meet-web-push/).

## Changed file inventory

- Frontend: `src/context/NotificationContext.tsx`, `src/lib/notifications.ts`,
  `src/components/NotificationSettings.tsx`,
  `src/components/MessengerNotifications.css`, `src/components/CallPanel.tsx`,
  `src/components/SettingsPage.tsx`, `src/lib/authSession.ts`, `src/App.tsx`.
- PWA: `index.html`, `public/notifications-sw.js`,
  `public/notification-core.js`, `public/manifest.webmanifest`, and the three
  `public/icons/` PNG exports of the existing logo.
- Backend/deploy: the SQL migration above, `services/push-dispatcher/dispatcher.py`,
  its `Dockerfile` and `requirements.txt`, `deploy/push-dispatcher.compose.yml`,
  `scripts/deploy.sh`, `scripts/backup-full.sh`.
- Checks/documentation: `tests/messenger-notifications-db.mjs`,
  `tests/messenger-notifications-worker.mjs`, `tests/push-dispatcher.py`,
  `tests/messenger-notifications-ui.mjs`, its HTML and TSX harness,
  `tests/deployment-compose.mjs`, both regression runners, CI workflow,
  `MODAL_SAFETY.md`, and this document.
