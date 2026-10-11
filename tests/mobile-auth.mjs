// Real Supabase Auth client + real application providers; only the servers/media
// devices are fixtures. Never connect to production or use real account tokens.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const kind = process.env.BROWSER_TYPE || 'chromium';
const browser = await playwright[kind].launch({ headless: true, ...(kind === 'chromium' ? { channel: process.env.BROWSER_CHANNEL || 'msedge' } : {}) });
const server = await createServer({ configFile: false, root: process.cwd(), base: '/video/', plugins: [react()], envPrefix: [],
  resolve: { alias: { '@': path.resolve('src') } },
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://auth-test.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fixture-anon') },
  server: { host: '127.0.0.1', port: 5220, strictPort: true } });
const user = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'fixture@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const jwt = generation => [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000) + 3600, generation }), 'fixture-signature'].map(value => Buffer.from(value).toString('base64url')).join('.');
const key = 'sb-auth-test-auth-token';
const url = 'http://127.0.0.1:5220/video/tests/mobile-auth.html';
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
try {
  await server.listen();
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 500 });
    let token = jwt(0), refreshes = 0, relayReject = false, forbidden = false, invalidRefresh = false;
    let rejectRpc = false, rpcRejected = 0, relayAttempts = 0, logoutAttempts = 0;
    let suspended = null, holdRefresh = false, activeCall = null, incoming = false;
    let logoutResume = null, holdLogout = false, logins = 0, rejectAllRelay = false;
    const rejectedTokens = new Set();
    const errors = [];
    const session = () => ({ access_token: token, refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user });
    await context.addInitScript(({ key, saved }) => {
      if (!localStorage.getItem('fixture-seeded')) { localStorage.setItem(key, JSON.stringify(saved)); localStorage.setItem('fixture-seeded', 'yes'); }
      window.__capture = [];
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
        canvas.getContext('2d').fillRect(0, 0, 8, 8);
        const stream = canvas.captureStream(1); window.__capture.push(stream); return stream;
      };
      navigator.mediaDevices.enumerateDevices = async () => [];
    }, { key, saved: session() });
    const call = () => ({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', conversation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      caller_id: incoming ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : user.id, caller_name: 'Caller fixture', name: 'Video fixture',
      media: 'video', state: incoming ? 'ringing' : 'active', my_state: incoming ? 'invited' : 'joined', mine: !incoming, seen: false,
      started_at: new Date().toISOString(), answered_at: null, ended_at: null, duration: 0, outcome: null,
      members: [{ id: user.id, name: 'Fixture', state: incoming ? 'invited' : 'joined' }] });
    await context.route('https://auth-test.supabase.co/**', async route => {
      const request = route.request(), endpoint = new URL(request.url()), body = request.postData() ? request.postDataJSON() : {};
      const authorization = request.headers().authorization;
      if (endpoint.pathname === '/auth/v1/token') {
        refreshes++;
        if (holdRefresh) await new Promise(resolve => { suspended = resolve; });
        if (invalidRefresh) return route.fulfill({ status: 400, json: { message: 'Refresh token is invalid', error_code: 'refresh_token_not_found' } });
        token = jwt(refreshes); return route.fulfill({ json: session() }).catch(() => undefined);
      }
      if (endpoint.pathname === '/auth/v1/user') return route.fulfill({ json: user });
      if (endpoint.pathname === '/auth/v1/logout') {
        logoutAttempts++;
        if (holdLogout) await new Promise(resolve => { logoutResume = resolve; });
        return route.fulfill({ status: 503, json: { message: 'Fixture logout outage' } });
      }
      if (endpoint.pathname.endsWith('/functions/v1/account-login')) { logins++; token = jwt(++refreshes); return route.fulfill({ json: { session: session() } }); }
      if (endpoint.pathname.endsWith('/functions/v1/messenger-calls')) {
        relayAttempts++;
        if (forbidden) return route.fulfill({ status: 403, json: { message: 'An active account is required.' } });
        if (relayReject) { relayReject = false; rejectedTokens.add(authorization); }
        if (rejectAllRelay || rejectedTokens.has(authorization) || authorization !== `Bearer ${token}`) {
          return route.fulfill({ status: 401, json: { message: 'Please sign in.' } });
        }
        return route.fulfill({ json: body.action === 'configuration' ? { configured: true, maxParticipants: 4 } : { iceServers: [], expiresAt: Date.now()+3600000 } });
      }
      if (endpoint.pathname.endsWith('/rpc/messenger_calls_rpc')) {
        if (rejectRpc) { rejectRpc = false; rpcRejected++; return route.fulfill({ status: 401, json: { code: 'PGRST301', message: 'JWT expired' } }); }
        let result = null;
        if (body.p_action === 'inbox') result = activeCall ? [activeCall] : incoming ? [call()] : [];
        if (body.p_action === 'start' || body.p_action === 'accept') { activeCall = { ...call(), state: 'active', my_state: 'joined' }; incoming = false; result = activeCall; }
        if (body.p_action === 'end') { activeCall = null; result = {}; }
        if (body.p_action === 'heartbeat') result = activeCall;
        if (body.p_action === 'signals') result = [];
        return route.fulfill({ json: result });
      }
      if (endpoint.pathname.endsWith('/rpc/messenger_rpc')) return route.fulfill({ json: body.p_action === 'inbox' ? { conversations: [], unread: 0 } : {} });
      if (endpoint.pathname.endsWith('/rpc/is_admin')) return route.fulfill({ json: false });
      return route.fulfill({ json: [] });
    });
    try {
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      await page.getByTestId('auth-user').filter({ hasText: user.email }).waitFor();
      relayReject = true;
      await page.getByRole('button', { name: 'Start video call', exact: true }).click();
      await page.getByRole('button', { name: 'End call', exact: true }).waitFor();
      assert.equal(refreshes, 1); assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'End call', exact: true }).click();
      await page.getByRole('button', { name: 'End call', exact: true }).waitFor({ state: 'detached' });
      pass(`${kind} ${width}px: outgoing video call refreshes a rejected token without asking for sign-in`);

      relayReject = true; incoming = true; rejectRpc = true;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('messenger-call')));
      await page.getByRole('button', { name: 'Accept', exact: true }).click();
      await page.getByRole('button', { name: 'End call', exact: true }).waitFor();
      assert.equal(rpcRejected, 1); assert.equal(await page.getByTestId('auth-user').innerText(), user.email);
      await page.getByRole('button', { name: 'End call', exact: true }).click();
      await page.getByRole('button', { name: 'End call', exact: true }).waitFor({ state: 'detached' });
      pass(`${kind} ${width}px: incoming video call recovers both RPC and relay authentication`);

      const before = refreshes;
      relayReject = true;
      await page.getByRole('button', { name: 'Check call session' }).click();
      await page.getByTestId('probe').filter({ hasText: 'Ready' }).waitFor();
      assert.equal(refreshes, before + 1);
      forbidden = true;
      const forbiddenBefore = refreshes, attemptsBefore = relayAttempts;
      await page.getByRole('button', { name: 'Start video call', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'An active account is required.' }).waitFor();
      assert.equal(refreshes, forbiddenBefore); assert.equal(relayAttempts, attemptsBefore + 1);
      forbidden = false;
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      pass(`${kind} ${width}px: concurrent 401s share refresh; permission denial never retries or bypasses authorization`);
      rejectAllRelay = true;
      const repeatedBefore = refreshes, repeatedAttempts = relayAttempts;
      await page.getByRole('button', { name: 'Start video call', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Calling could not verify your session.' }).waitFor();
      assert.equal(refreshes, repeatedBefore + 1); assert.equal(relayAttempts, repeatedAttempts + 2);
      rejectAllRelay = false;
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      pass(`${kind} ${width}px: repeated 401 stops after one retry and does not misleadingly request another sign-in`);

      const otherPage = await context.newPage(); otherPage.on('pageerror', error => errors.push(error.message));
      otherPage.setDefaultTimeout(15000);
      await otherPage.goto(url); await otherPage.getByTestId('auth-user').filter({ hasText: user.email }).waitFor();
      await page.bringToFront();
      await page.getByRole('button', { name: 'Start video call', exact: true }).click();
      await page.getByRole('button', { name: 'End call', exact: true }).waitFor();
      holdRefresh = true;
      await page.getByRole('button', { name: 'Refresh fixture session' }).click();
      await assertEventually(() => suspended !== null);
      await page.getByRole('button', { name: 'Account menu', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByTestId('auth-user').filter({ hasText: 'Signed out' }).waitFor();
      await otherPage.getByTestId('auth-user').filter({ hasText: 'Signed out' }).waitFor();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
      assert.equal(await page.getByRole('button', { name: 'End call', exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.__capture.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
      suspended(); holdRefresh = false;
      await page.getByTestId('refresh-state').filter({ hasText: 'Finished' }).waitFor();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
      assert.equal(await page.getByTestId('auth-user').innerText(), 'Signed out');
      await assertEventually(() => logoutAttempts > 0);
      await page.reload();
      await page.getByTestId('auth-user').filter({ hasText: 'Signed out' }).waitFor();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
      pass(`${kind} ${width}px: sign-out survives server outage and an in-flight refresh, clears both tabs and persisted tokens, stops call capture`);

      activeCall = null;
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByTestId('auth-user').filter({ hasText: user.email }).waitFor();
      await otherPage.getByTestId('auth-user').filter({ hasText: user.email }).waitFor();
      assert.ok(await page.evaluate(key => localStorage.getItem(key), key));
      pass(`${kind} ${width}px: explicit new login persists normally and synchronizes the other tab`);

      holdLogout = true;
      await page.getByRole('button', { name: 'Account menu', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await otherPage.getByTestId('auth-user').filter({ hasText: 'Signed out' }).waitFor();
      await assertEventually(() => logoutResume !== null);
      const loginsBefore = logins;
      await otherPage.getByRole('button', { name: 'Sign in', exact: true }).click();
      await new Promise(resolve => setTimeout(resolve, 200));
      assert.equal(logins, loginsBefore, 'A delayed global logout must finish before the other tab creates a new session');
      holdLogout = false; logoutResume();
      await otherPage.getByTestId('auth-user').filter({ hasText: user.email }).waitFor();
      await page.getByTestId('auth-user').filter({ hasText: user.email }).waitFor();
      pass(`${kind} ${width}px: delayed global logout cannot revoke a new login from another tab`);

      invalidRefresh = true;
      await page.getByRole('button', { name: 'Refresh fixture session' }).click();
      await page.getByTestId('auth-user').filter({ hasText: 'Signed out' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 1);
      assert.deepEqual(errors, []);
      pass(`${kind} ${width}px: a genuinely invalid refresh ends the session; no stale signed-in UI or browser errors`);
      invalidRefresh = false;
      await page.evaluate(() => {
        for (const method of ['getItem','setItem','removeItem']) Storage.prototype[method] = () => { throw new DOMException('Fixture storage blocked', 'SecurityError'); };
      });
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByTestId('auth-user').filter({ hasText: user.email }).waitFor();
      await page.getByRole('button', { name: 'Start video call', exact: true }).click();
      await page.getByRole('button', { name: 'End call', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Account menu', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByTestId('auth-user').filter({ hasText: 'Signed out' }).waitFor();
      assert.deepEqual(errors, []);
      pass(`${kind} ${width}px: blocked browser storage still permits same-tab login, calling and complete local sign-out`);
    } finally { suspended?.(); logoutResume?.(); await context.close(); }
  }
} finally { await browser.close(); await server.close(); }
console.log(`${checks} auth/session checks passed (local browser tests; no physical-device or live TURN media validation).`);

async function assertEventually(check) {
  const until = Date.now() + 10000;
  while (!check()) { assert.ok(Date.now() < until, 'Fixture condition timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
