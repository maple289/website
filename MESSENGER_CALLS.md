# Messenger voice/video calls

Calls use WebRTC with an authenticated TURN relay. Incoming calls appear across
all signed-in site routes. The floating panel stays mounted while browsing;
Expand shows device selectors, and Minimize returns to the floating panel.
Accept, Decline, End call, mute, camera toggle and video screen sharing are
explicit controls. Screen sharing invokes the browser permission picker on every
start. The browser may require Play call audio after blocking autoplay.

Groups of two to four conversation members use a bounded peer mesh. Larger
groups cannot call; do not raise this limit without moving group media to an SFU.
Calls ring for 45 seconds. Browser heartbeats preserve calls across brief network
loss; a participant disconnected for 90 seconds leaves the call. ICE restarts
recover media connectivity. Relay credentials refresh without restarting a
healthy media connection. Calls have
a four-hour ceiling. Closing the browser/signing out stops capture; the server
expires an abandoned session. Mobile background suspension may expire a call.

## Local TURN integration

The operator has installed TURN locally and configured port forwarding. This
checkout uses that service; it neither installs a second relay nor provisions a
hosted provider. Production networking uses `myhostage.ca`, TCP/UDP 3478 and
UDP relay ports 50000–50100 on 192.168.1.191. Router/ASA settings, the VM address,
relay range and the existing five-minute public-IP updater must remain unchanged.
TLS/TURNS is outside this deployment: retain `no-tls` and `no-dtls`.

For coturn, use TURN REST authentication (`use-auth-secret` and a private
`static-auth-secret`). Add matching settings to the Supabase **runtime**
environment file, normally `/srv/streamly/supabase/.env`:

```dotenv
TURN_SHARED_SECRET=<generated-and-installed-on-server-only>
TURN_URLS=turn:myhostage.ca:3478?transport=udp,turn:myhostage.ca:3478?transport=tcp
STUN_URLS=stun:myhostage.ca:3478
```

Keep the file private. These are backend settings, never `VITE_` variables.
The Compose override reads the runtime file; the frontend checkout's `.env`
does not configure the Edge service. The secret must match coturn exactly and
must never be sent to the browser. If the installed service currently uses
static username/password authentication, coordinate the change to TURN REST
authentication before enabling calls; those mechanisms must not be mixed.

Generate a 32-byte random shared secret directly on Ubuntu; never print it or
copy it into this checkout. The matching value belongs in `static-auth-secret`
and `TURN_SHARED_SECRET` only. Restrict secret-bearing configuration and backups.
Before changing coturn authentication, take a timestamped copy of the working
configuration. Remove static `user=` entries and `lt-cred-mech` when enabling
`use-auth-secret`; preserve every networking directive. If authentication fails,
restore that backup and restart coturn. Never use the temporary `turntest`
account in the browser application.

The authenticated Edge endpoint verifies the account and joined call session,
then signs one-hour credentials locally. It rechecks access before returning
them. Credentials are private/no-store, with issuance limited to once every
30 seconds per joined session. The shared secret remains server-side.
Credentials already returned to a browser remain valid until their TTL;
ending a call closes local peer connections. Configuration preflight returns
no credentials, rejects malformed relay URLs and fails closed when the secret
or relay URLs are missing. It does not prove network reachability.
New calls always request fresh credentials. Normal connections explicitly use
`iceTransportPolicy: 'all'`; no production relay-only switch is enabled.

Before deployment, back up the database and runtime configuration using the
existing procedure. `scripts/deploy.sh` applies the call migration, synchronizes
`messenger-calls`, loads the runtime settings through
`deploy/messenger.compose.yml`, and rebuilds the frontend/preview worker.
Use HTTPS for the website and its Supabase API/WebSocket endpoint.

## Authorization, history and notifications

Database RPCs derive the actor from `auth.uid()`, verify an active registered
account, current conversation membership, and every pair's block status. Relay
credentials, signaling and heartbeats require the exact joined browser session.
Only one outstanding call per participant is allowed. Browser table access is
revoked with RLS enabled. Private existing Messenger channels carry identifiers;
SDP/ICE is fetched only by the intended joined recipient, with bounded size/rate.

Conversation history stores caller/participants, media type, timestamps, duration
and completed/missed/declined/cancelled/failed outcomes. No audio/video recording
or media storage is introduced. Temporary signaling rows expire after two minutes
and are removed when a call ends. The existing worker reconciles abandoned calls
in its maintenance pass; interactive call RPCs reconcile independently of worker
conversion tasks. Chat/Edge/Realtime remain separate from the FFmpeg worker.

History uses the existing message timeline and confirmed scoped deletion paths.
Call events cannot be edited. Deleting/hiding history does not hang up an ongoing
call, and does not erase the private call metadata. Missed notifications disappear
when acknowledged or when their associated history is hidden/deleted. Invitations
and missed calls extend the blue-bar bell and link to the conversation; the global
incoming panel provides Accept/Decline even after opening the invitation.

## Verification and remaining live checks

`tests/messenger-calls.mjs` applies the actual Messenger/call migrations to an
isolated PGlite PostgreSQL instance. Set `PGLITE_MODULE` to an installed PGlite ESM
entry and run `node tests/messenger-calls.mjs`. It checks authorization, busy and
idempotent starts, per-session signaling/credentials, history, missed/declined
calls, revocation and group limits. Frontend/media lifecycle and Edge credential
checks are in `tests/messenger-call-engine.mjs` and `tests/messenger-call-relay.mjs`.

Before declaring Phase 2 live, use two approved accounts on separate networks,
plus a third/fourth for groups and a logged-out browser. Verify actual media and
TURN relay connectivity, incoming calls while browsing Photos/Videos/Files,
duration, bell links, decline/timeout, mic/camera, device changes, screen permission
and stop sharing, minimize/navigation, brief disconnect/reconnect, and history.
Check blocked users, nonmembers, account suspension and membership removal during
a call. Check desktop/mobile layout, browser autoplay, and outside-click/Escape
modal safety. Use WebRTC diagnostics to verify a `relay` candidate pair on a
restricted network. Local checks do not prove live TURN/media exchange.

The current cleanup removes the hosted-provider branch, tokens and test
fixtures. The calling UI, signaling migration, cleanup worker and local TURN
credential generation remain. The updated relay fixtures cover local signing
and authorization only. Production TURN configuration and live media exchange
have not been verified; deployment awaits the operator's next configuration
instructions. Earlier build/check results are not proof that the newly installed
relay is reachable or that calls work across networks.

Local-TURN cleanup: frontend and Edge TypeScript checks, affected frontend ESLint,
and Git whitespace checks passed. No live-server settings were changed during
this cleanup, and the updated behavioral tests were not run.
