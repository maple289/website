// Offline regression tests: actual handlers and SQL; mocked Resend, no real mail.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { PGlite } from '../.runtime/sharing-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db = new PGlite();
const env = new Map([['RESEND_API_KEY', 're_test_secret_not_real'], ['RESEND_FROM_EMAIL', 'Streamly <mail@example.test>'], ['CUSTOMER_EMAILS_ENABLED', 'true'], ['SITE_URL', 'https://myhostage.ca/video/'], ['SITE_NAME', 'Streamly']]);
const logs = [], sent = [];
const originalLog = console.log, originalInfo = console.info, originalError = console.error, originalWarn = console.warn;
console.info = console.error = console.warn = (...args) => logs.push(args.join(' '));
let handler, mode = 'ok', checks = 0;
const adminId = '11111111-1111-4111-8111-111111111111';
let callerId = adminId;
let failRegistrationLookup = false;
globalThis.Deno = { env: { get: (name) => env.get(name) }, serve: (fn) => { handler = fn; } };
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(options.headers.Authorization, 'Bearer re_test_secret_not_real');
  const body = JSON.parse(options.body);
  sent.push({ body, key: options.headers['Idempotency-Key'] });
  if (mode === 'rate-limit') { mode = 'ok'; return Response.json({ name: 'rate_limit_exceeded', message: 'Slow down' }, { status: 429 }); }
  if (mode === 'network') throw new Error('connection failed re_test_secret_not_real');
  if (mode === 'invalid') return Response.json({ name: 'validation_error', message: 'API key is invalid re_test_secret_not_real' }, { status: 401 });
  if (mode === 'domain') return Response.json({ name: 'validation_error', message: 'Domain is not verified' }, { status: 403 });
  return Response.json({ id: crypto.randomUUID() });
};
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; originalLog(`PASS ${label}`); };
// Supabase adapter backed by a real local PostgreSQL engine.
const client = {
  auth: { getUser: async () => ({ data: { user: callerId ? { id: callerId } : null }, error: null }),
    admin: {} },
  from(table) {
    let action = 'select', values, filters = [], single = false, ignore = false;
    const builder = {
      select() { return builder; },
      insert(value) { action = 'insert'; values = value; return builder; },
      upsert(value, opts) { action = 'insert'; values = value; ignore = opts?.ignoreDuplicates; return builder; },
      update(value) { action = 'update'; values = value; return builder; },
      eq(key, value) { filters.push([key, value]); return builder; },
      single() { single = true; return builder; }, maybeSingle() { single = true; return builder; },
      async then(resolve) {
        if (failRegistrationLookup && table === 'pending_registrations' && action === 'select') {
          failRegistrationLookup = false;
          return resolve({ data: null, error: { code: 'TEST_LOOKUP_FAILURE' } });
        }
        try {
          let sql, args = [];
          if (action === 'insert') {
            const keys = Object.keys(values); args = Object.values(values);
            sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})${ignore ? ' ON CONFLICT DO NOTHING' : ''} RETURNING *`;
          } else {
            sql = action === 'select' ? `SELECT * FROM ${table}` : `UPDATE ${table} SET ` + Object.entries(values).map(([key, value]) => { args.push(value); return `${key}=$${args.length}`; }).join(',');
            if (filters.length) sql += ' WHERE ' + filters.map(([key, value]) => { args.push(value); return `${key}=$${args.length}`; }).join(' AND ');
            if (action === 'update') sql += ' RETURNING *';
          }
          const result = await db.query(sql, args);
          const rows = JSON.parse(JSON.stringify(result.rows));
          return resolve({ data: single ? rows[0] ?? null : rows, error: null });
        } catch (error) { return resolve({ data: null, error: { code: error.code, message: error.message } }); }
      },
    };
    return builder;
  },
  async rpc(name, args) { try { const { rows } = await db.query(`SELECT ${name}($1) AS result`, [args.delivery_id ?? args.p_registration_id ?? args.p_email]); return { data: rows[0].result, error: null }; } catch (error) { return { data: null, error }; } },
};
globalThis.__emailTestClient = client;
const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64');
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE pending_registrations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, username text UNIQUE, first_name text, last_name text, created_at timestamptz DEFAULT now(), status text DEFAULT 'pending', reviewed_at timestamptz, reviewed_by uuid);
    CREATE TABLE profiles(id uuid DEFAULT gen_random_uuid(), email text, role text);
    INSERT INTO profiles(email,role) VALUES ('admin-one@example.test','admin'),('admin-two@example.test','admin'),('member@example.test','user');`);
  await db.query("UPDATE profiles SET id=$1 WHERE email='admin-one@example.test'", [adminId]);
  await db.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(email text);');
  await db.exec(await readFile(new URL('../supabase/migrations/20260930200000_registration_email_check.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260924050000_registration_email_delivery.sql', import.meta.url), 'utf8'));
  await db.exec(`ALTER TABLE registration_email_deliveries DROP CONSTRAINT registration_email_deliveries_registration_id_fkey;
    ALTER TABLE registration_email_deliveries ADD COLUMN plain_text text; ALTER TABLE registration_email_deliveries ADD COLUMN sender text;
    CREATE TABLE account_activation(registration_id uuid UNIQUE,user_id uuid, email text,first_name text,must_change_password boolean DEFAULT true);
    CREATE FUNCTION approve_pending_account(request_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE r pending_registrations%ROWTYPE; a account_activation%ROWTYPE;
    BEGIN
      SELECT * INTO a FROM account_activation WHERE registration_id=request_id;
      IF FOUND THEN RETURN to_jsonb(a); END IF;
      SELECT * INTO r FROM pending_registrations WHERE id=request_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Pending registration not found'; END IF;
      IF r.status<>'pending' THEN RAISE EXCEPTION 'Registration has already been reviewed'; END IF;
      IF EXISTS(SELECT 1 FROM profiles WHERE email=r.email) THEN RAISE EXCEPTION 'An account with this email already exists'; END IF;
      INSERT INTO account_activation(registration_id,user_id,email,first_name) VALUES(r.id,gen_random_uuid(),r.email,r.first_name) RETURNING * INTO a;
      INSERT INTO profiles(id,email,role) VALUES(a.user_id,a.email,'user');
      DELETE FROM pending_registrations WHERE id=r.id; RETURN to_jsonb(a);
    END; $$;`);
  const sharedUrl = moduleUrl(await readFile(new URL('../supabase/functions/_shared/email.ts', import.meta.url), 'utf8'));
  const shared = await import(sharedUrl);
  const templatesUrl = moduleUrl((await readFile(new URL('../supabase/functions/_shared/registration-templates.ts', import.meta.url), 'utf8')).replace('"./email.ts"', JSON.stringify(sharedUrl)));
  let endpoint = await readFile(new URL('../supabase/functions/notify-admin-registration/index.ts', import.meta.url), 'utf8');
  const prepare = source => source.replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";', '').replace('import { createClient } from "npm:@supabase/supabase-js@2.57.4";', 'const createClient = () => globalThis.__emailTestClient;').replace('"../_shared/email.ts"', JSON.stringify(sharedUrl)).replace('"../_shared/registration-templates.ts"', JSON.stringify(templatesUrl));
  endpoint = prepare(endpoint);
  await import(moduleUrl(endpoint));
  const registrationHandler = handler;
  const submit = (email, first_name = 'Alex') => registrationHandler(new Request('https://local.test/registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, first_name }) }));
  let response = await submit('new@example.test', '<script>');
  check(response.status, 200, 'registration succeeds');
  check(sent.length, 3, 'receipt plus notification to every admin (not ordinary members)');
  check(sent[0].body.to, ['new@example.test'], 'user receipt has correct recipient');
  check(sent[0].body.subject, 'Registration Request Received', 'receipt uses requested subject');
  check(sent.every(mail => mail.body.text?.length > 0), true, 'all notification emails include a plain-text alternative');
  check(sent[0].body.html.includes('https://myhostage.ca/video/') && sent[0].body.html.includes('pending administrator approval'), true, 'receipt identifies website and pending status');
  check(sent[1].body.html.includes('&lt;script&gt;'), true, 'admin names are HTML escaped');
  check(sent.every((mail) => mail.body.from === 'Streamly <mail@example.test>'), true, 'configured sender used');
  check((await submit('new@example.test')).status, 409, 'duplicate pending request displays a warning');
  check(sent.length, 3, 'duplicate submission sends no duplicate mail');
  check((await db.query('SELECT count(*)::int AS n FROM pending_registrations')).rows[0].n, 1, 'duplicate creates no extra registration');
  env.delete('RESEND_API_KEY');
  response = await submit('missing@example.test');
  check(response.status, 200, 'missing key does not undo registration');
  check(sent.length, 3, 'missing key does not make a Resend request');
  check(logs.some((line) => line.includes('RESEND_API_KEY missing')), true, 'missing key is logged');
  env.set('RESEND_API_KEY', 're_test_secret_not_real'); mode = 'invalid';
  response = await submit('invalid@example.test');
  check(response.status, 200, 'invalid key leaves registration intact');
  check((await db.query("SELECT count(*)::int AS n FROM registration_email_deliveries WHERE status='failed' AND http_status=401")).rows[0].n, 3, 'each invalid-key send records status and failure');
  mode = 'domain'; await submit('domain@example.test');
  check(logs.some((line) => line.includes('Domain is not verified') && line.includes('403')), true, 'sender rejection logged with status');
  check((await db.query("SELECT status FROM pending_registrations WHERE email='domain@example.test'")).rows[0].status, 'pending', 'unverified sender preserves the request for admin approval');
  check(sent.filter((mail) => mail.body.to[0] === 'admin-two@example.test').length, 3, 'later admins are attempted even when earlier recipients fail');
  mode = 'network'; await shared.sendEmail({ to: 'a@example.test', subject: 'Test', html: 'Test', operation: 'test_network', key: 'test-network' });
  check(logs.some((line) => line.includes('transport_error')), true, 'transport failure logged');
  check(logs.join('').includes('re_test_secret_not_real'), false, 'secret redacted from all error logs');
  mode = 'ok';
  await db.exec("UPDATE registration_email_deliveries SET last_attempt_at=now()-interval '2 minutes' WHERE http_status=401");
  const beforeRetry = sent.length; await submit('invalid@example.test');
  check(sent.length - beforeRetry, 3, 'retry recovers failed messages independently');
  const id = (await db.query("SELECT id FROM registration_email_deliveries WHERE status='failed' LIMIT 1")).rows[0].id;
  await db.query("UPDATE registration_email_deliveries SET last_attempt_at=now()-interval '2 minutes' WHERE id=$1", [id]);
  const claims = await Promise.all([client.rpc('claim_registration_email', { delivery_id: id }), client.rpc('claim_registration_email', { delivery_id: id })]);
  check(claims.filter((result) => result.data).length, 1, 'concurrent sends claim a delivery only once');
  await db.query("UPDATE registration_email_deliveries SET first_attempt_at=now()-interval '25 hours', last_attempt_at=now()-interval '2 minutes' WHERE id=$1", [id]);
  check((await client.rpc('claim_registration_email', { delivery_id: id })).data, false, 'ambiguous old messages are not resent after idempotency expiry');
  await db.exec('SET ROLE anon');
  let denied = false; try { await db.query('SELECT * FROM registration_email_deliveries'); } catch { denied = true; }
  check(denied, true, 'public cannot read delivery recipients or metadata');
  denied = false; try { await db.query('SELECT claim_registration_email($1)', [id]); } catch { denied = true; }
  check(denied, true, 'public cannot claim delivery records');
  await db.exec('RESET ROLE');
  check((await submit('not-an-email')).status, 400, 'invalid registration email rejected');
  failRegistrationLookup = true;
  check((await submit('lookup-error@example.test')).status, 500, 'database lookup failure is not reported as a successful registration');
  check((await db.query("SELECT status FROM pending_registrations WHERE email='lookup-error@example.test'")).rows[0].status, 'pending', 'lookup failure still preserves an already saved pending request');
  const beforeReviewed = sent.length;
  for (const status of ['approved', 'rejected']) {
    await db.query('INSERT INTO pending_registrations(email,status) VALUES ($1,$2)', [`${status}@example.test`, status]);
    check((await submit(`${status}@example.test`)).status, 409, `${status} duplicate displays a reviewed-request warning`);
    check((await db.query('SELECT status FROM pending_registrations WHERE email=$1', [`${status}@example.test`])).rows[0].status, status, `${status} duplicate cannot reopen a reviewed request`);
  }
  check(sent.length, beforeReviewed, 'reviewed duplicates send no new notifications');
  const configuredSender = env.get('RESEND_FROM_EMAIL');
  env.delete('RESEND_FROM_EMAIL');
  env.set('SMTP_ADMIN_EMAIL', 'legacy-sender@example.test');
  const beforeMissingSender = sent.length;
  const noSender = await shared.sendEmail({ to: 'a@example.test', subject: 'Test', html: 'Test', operation: 'test_sender', key: 'test-sender' });
  check(noSender.type, 'configuration_error', 'explicit Resend sender is required; SMTP admin setting is not an API fallback');
  check(sent.length, beforeMissingSender, 'missing sender does not contact Resend');
  env.set('RESEND_FROM_EMAIL', configuredSender);
  env.delete('SMTP_ADMIN_EMAIL');
  mode = 'rate-limit';
  const beforeRate = sent.length;
  const rateResult = await shared.sendEmail({ to: 'rate@example.test', subject: 'Test', html: 'Test', operation: 'rate_test', key: 'rate-fixed-key' });
  check(rateResult.accepted, true, 'rate-limited delivery recovers');
  check(sent.length - beforeRate, 2, 'rate-limit retry is bounded');
  check(sent.at(-1).key, sent.at(-2).key, 'rate-limit retry preserves idempotency key');
  env.set('CUSTOMER_EMAILS_ENABLED', 'false');
  const beforeSuppressed = sent.length;
  await submit('suppressed@example.test');
  check(sent.length - beforeSuppressed, 2, 'customer mail disabled while all admins remain enabled');
  check(sent.slice(beforeSuppressed).every(mail => mail.body.to[0].startsWith('admin-')), true, 'only administrators receive registration notifications');
  check(logs.some(line => line.includes('customer_email_temporarily_disabled')), true, 'temporary customer suppression is visible in safe logs');
  check(logs.join('').includes('re_test_secret_not_real'), false, 'secrets stay redacted');
  env.set('CUSTOMER_EMAILS_ENABLED', 'true');
  env.set('RESEND_FROM_NAME', 'MyHostage'); env.set('RESEND_FROM_EMAIL', 'noreply@myhostage.ca');
  await submit('approval@example.test');
  const registrationId = (await db.query("SELECT id FROM pending_registrations WHERE email='approval@example.test'")).rows[0].id;
  const approvalSource = prepare(await readFile(new URL('../supabase/functions/approve-registration/index.ts', import.meta.url), 'utf8'));
  await import(moduleUrl(approvalSource));
  const approve = id => handler(new Request('https://local.test/approval', { method: 'POST', headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', registrationId: id }) }));
  const beforeApproval = sent.length;
  check((await approve(registrationId)).status, 200, 'actual approval handler succeeds');
  check(sent.length - beforeApproval, 1, 'approval sends one customer email');
  check(sent.at(-1).body.from, 'MyHostage <noreply@myhostage.ca>', 'sender name and domain address are independently configurable');
  check(sent.at(-1).body.subject, 'Your Account Has Been Approved', 'approval uses requested subject');
  check(sent.at(-1).body.text.includes('https://myhostage.ca/video/#/login') && sent.at(-1).body.text.includes('leave the password field blank'), true, 'approval has direct login link and accurate initial setup instructions');
  check((await db.query('SELECT count(*)::int AS n FROM pending_registrations WHERE id=$1', [registrationId])).rows[0].n, 0, 'approved pending row removed');
  check((await approve(registrationId)).status, 200, 'approval retry succeeds after pending row removal');
  check(sent.length, beforeApproval + 1, 'approval retry does not duplicate email');
  check((await submit('approval@example.test')).status, 409, 'registration retry after approval warns that the email exists');
  check(sent.length, beforeApproval + 1, 'registration retry after approval neither recreates request nor resends receipt');
  const duplicateAccount = await submit('  ADMIN-ONE@EXAMPLE.TEST  ');
  check(duplicateAccount.status, 409, 'existing account lookup ignores case and surrounding whitespace');
  const duplicateBody = await duplicateAccount.json();
  check(duplicateBody.code, 'EMAIL_ALREADY_REGISTERED', 'existing account response identifies email conflict');
  check(duplicateBody.error.includes('Please enter another email address'), true, 'existing account warning suggests another email');
  await db.exec("INSERT INTO auth.users(email) VALUES('orphan-auth@example.test')");
  check((await submit('orphan-auth@example.test')).status, 409, 'Auth account without a profile also blocks duplicate registration');
  check(sent.length, beforeApproval + 1, 'existing account warnings trigger no notifications');
  callerId = 'ordinary-member'; check((await approve(registrationId)).status, 403, 'non-admin cannot approve or trigger approval email'); callerId = adminId;
  await submit('approval-failure@example.test');
  const failedId = (await db.query("SELECT id FROM pending_registrations WHERE email='approval-failure@example.test'")).rows[0].id;
  mode = 'domain'; check((await approve(failedId)).status, 200, 'approval email failure cannot cancel account creation');
  check((await db.query("SELECT role FROM profiles WHERE email='approval-failure@example.test'")).rows[0].role, 'user', 'account retains user role when email fails');
  check((await db.query("SELECT status FROM registration_email_deliveries WHERE registration_id=$1 AND operation='registration_approved'", [failedId])).rows[0].status, 'failed', 'approval failure persists diagnostics after pending row deletion');
  mode = 'ok'; await db.query("UPDATE registration_email_deliveries SET last_attempt_at=now()-interval '2 minutes' WHERE registration_id=$1", [failedId]);
  check((await approve(failedId)).status, 200, 'failed approval email can be retried without recreating account');
  check((await db.query("SELECT status FROM registration_email_deliveries WHERE registration_id=$1 AND operation='registration_approved'", [failedId])).rows[0].status, 'sent', 'approval retry recovers failed delivery');
  const beforeRejected = sent.length;
  await shared.deliverEmail(client, crypto.randomUUID(), 'registration_rejected', 'a@example.test', 'Rejected', '<p>Rejected</p>');
  check(sent.length, beforeRejected, 'unrequested customer notifications remain disabled');
  originalLog(`${checks} checks passed; no external emails sent.`);
} finally {
  console.log = originalLog; console.info = originalInfo; console.error = originalError; console.warn = originalWarn;
  await db.close();
}
