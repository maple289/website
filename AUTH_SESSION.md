# Authentication and calling sessions

The main application, Messenger RPCs and call relay requests use the same
Supabase client and persisted session. The existing SDK storage key is retained;
users do not need to sign in again after this frontend update. SDK refresh and
cross-tab authentication locks remain enabled. Foreground, online and pageshow
events recover the current session; call polling also resumes on pageshow and
visibility changes. Auth listeners stay synchronous and do not await SDK calls.

Calls and Messenger retry an HTTP 401 once after refreshing the rejected token.
Concurrent requests share refresh work, and requests stop after sign-out or an
account switch. Permission failures (403) and uncertain mutations are not retried.
A relay still rejecting the refreshed token displays a call verification error
instead of telling an already signed-in user to sign in again. Server account,
membership, call-session, TURN and database authorization are unchanged.

Explicit sign-out immediately clears this application's persisted tokens and
password-setup state, updates other tabs and disposes the call engine/capture.
Late token responses cannot save or publish the old session. Remote global
revocation is still attempted with a bounded timeout; failure cannot keep this
device signed in. Offline sign-out cannot guarantee revocation on other devices.
New logins wait for pending local cleanup and bounded remote revocation, including
across tabs/reload, so a delayed logout does not revoke a newly created session.
Browsers without persistent storage retain only a same-tab in-memory session.

`tests/mobile-auth.mjs` uses the real Auth SDK, application providers, calling
engine, account menu and `/video/` base path with mocked servers/media capture.
It covers outgoing/incoming video calls, RPC/relay authentication recovery,
concurrent and repeated rejection, permission denial, sign-out during refresh
and a server outage, reload, cross-tab re-login, delayed logout, invalid
refresh tokens and blocked browser storage. Set `PLAYWRIGHT_MODULE` to the installed Playwright ESM module,
`BROWSER_TYPE=firefox` and `PLAYWRIGHT_BROWSERS_PATH` to a Firefox runtime to run
in Firefox; the default is Chromium/Edge. No production account is used.

Local Firefox phone-size/desktop and Chromium tests, call engine/relay tests,
TypeScript, affected-file ESLint and production build are the verification scope.
They do not replace an actual Firefox mobile test or live TURN media exchange.
This change requires a frontend release; it adds no database migration or server
authorization changes.
