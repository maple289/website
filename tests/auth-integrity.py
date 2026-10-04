"""Real GoTrue password/account tests in a shared, network-isolated test namespace.

Requires an empty, fully migrated audit_fresh schema and the matching Auth schema
migration version list (version numbers only, never user data). No production
ports, tokens, credentials, mail provider or storage mounts are used.
"""
import argparse
import base64
import hashlib
import hmac
import json
from pathlib import Path
import re
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--auth-migrations', type=Path, required=True)
    parser.add_argument('--auth-image', default='supabase/gotrue:v2.189.0')
    args = parser.parse_args()
    details = json.loads(subprocess.check_output(['docker', 'inspect', args.container]))[0]
    if not args.container.startswith('streamly-audit-db-') or details['HostConfig']['NetworkMode'] != 'none' or \
            details['HostConfig'].get('PortBindings') or details['HostConfig'].get('Binds'):
        raise SystemExit('Network-isolated audit database required')
    versions = args.auth_migrations.read_text().splitlines()
    assert versions and all(re.fullmatch(r'[0-9]+', value) for value in versions)
    run = uuid.uuid4().hex[:8]
    database = 'audit_auth_' + run
    auth = 'streamly-audit-auth-' + run
    client = 'streamly-audit-http-' + run
    made_auth = made_client = made_database = False
    checks = 0

    def command(parts, **kwargs):
        result = subprocess.run(parts, capture_output=True, text=True, timeout=60, **kwargs)
        if result.returncode:
            # Do not echo arguments, request bodies or credentials on failure.
            raise AssertionError('Isolated command failed: ' + result.stderr[-500:])
        return result.stdout.strip()

    def sql(source, target=database):
        return command(['docker', 'exec', '-i', args.container, 'psql', '-U', 'supabase_admin', '-d', target,
                        '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=source)

    def pass_check(label):
        nonlocal checks
        checks += 1
        print('PASS ' + label, flush=True)

    secret = uuid.uuid4().hex + uuid.uuid4().hex
    def jwt(role):
        def encode(value):
            return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=').decode()
        value = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({'role': role, 'iat': int(time.time()), 'exp': int(time.time()) + 1800})
        return value + '.' + base64.urlsafe_b64encode(hmac.new(secret.encode(), value.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()

    def http(method, path, body=None, token=None):
        # The client shares only the isolated DB's loopback namespace. Responses
        # are captured internally; passwords and returned tokens are not logged.
        request = dict(method=method, path=path, body=body, token=token)
        script = """import json,sys,urllib.request,urllib.error
d=json.load(sys.stdin)
headers={'Content-Type':'application/json'}
if d['token']:headers['Authorization']='Bearer '+d['token']
r=urllib.request.Request('http://127.0.0.1:9999'+d['path'],data=None if d['body'] is None else json.dumps(d['body']).encode(),headers=headers,method=d['method'])
try:
 with urllib.request.urlopen(r,timeout=10) as response: print(json.dumps([response.status,json.load(response)]))
except urllib.error.HTTPError as error:print(json.dumps([error.code,json.load(error)]))
"""
        return json.loads(command(['docker', 'exec', '-i', client, 'python', '-c', script], input=json.dumps(request)))

    try:
        assert sql('SELECT count(*) FROM auth.users;', 'audit_fresh') == '0', 'Schema-only baseline required'
        command(['docker', 'exec', args.container, 'createdb', '-U', 'supabase_admin', '-O', 'postgres', '-T', 'audit_fresh', database])
        made_database = True
        sql("ALTER ROLE supabase_auth_admin WITH LOGIN PASSWORD 'isolated-auth-fixture-only'; "
            "INSERT INTO auth.schema_migrations(version) VALUES " + ','.join("('" + v + "')" for v in versions) + ' ON CONFLICT DO NOTHING;')
        environment = {
            'GOTRUE_API_HOST': '127.0.0.1', 'GOTRUE_API_PORT': '9999',
            'API_EXTERNAL_URL': 'http://127.0.0.1:9999', 'GOTRUE_SITE_URL': 'https://audit.example.test',
            'GOTRUE_DB_DRIVER': 'postgres',
            'GOTRUE_DB_DATABASE_URL': 'postgres://supabase_auth_admin:isolated-auth-fixture-only@127.0.0.1:5432/' + database,
            'GOTRUE_JWT_SECRET': secret, 'GOTRUE_JWT_EXP': '3600', 'GOTRUE_JWT_AUD': 'authenticated',
            'GOTRUE_JWT_DEFAULT_GROUP_NAME': 'authenticated', 'GOTRUE_JWT_ADMIN_ROLES': 'service_role',
            'GOTRUE_DISABLE_SIGNUP': 'true', 'GOTRUE_MAILER_AUTOCONFIRM': 'true',
            'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD': 'true',
            'GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED': 'true',
            'GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI': 'pg-functions://postgres/public/account_access_token_hook',
            'GOTRUE_HOOK_SEND_EMAIL_ENABLED': 'true',
            'GOTRUE_HOOK_SEND_EMAIL_URI': 'pg-functions://postgres/public/suppress_customer_auth_email',
            'GOTRUE_MAILER_NOTIFICATIONS_PASSWORD_CHANGED_ENABLED': 'false',
        }
        command(['docker', 'run', '-d', '--name', auth, '--network', 'container:' + args.container,
                 '--memory', '256m', '--cpus', '0.5', '--pids-limit', '64',
                 *[part for key, value in environment.items() for part in ['-e', key + '=' + value]], args.auth_image])
        made_auth = True
        command(['docker', 'run', '-d', '--name', client, '--network', 'container:' + args.container,
                 '--memory', '128m', '--cpus', '0.5', '--entrypoint', 'python', 'supabase-media-worker',
                 '-c', 'import time;time.sleep(600)'])
        made_client = True
        for _ in range(30):
            try:
                if http('GET', '/health')[0] == 200: break
            except AssertionError: pass
            time.sleep(.5)
        else: raise AssertionError('Isolated Auth did not become ready; inspect its private logs')
        service = jwt('service_role')
        status, result = http('POST', '/admin/users', {'email': 'admin@audit.example.test', 'password': 'Fixture-Admin-123',
                'email_confirm': True, 'app_metadata': {'streamly_role': 'admin'},
                'user_metadata': {'first_name': 'Audit', 'last_name': 'Admin'}}, service)
        assert status in (200, 201), 'Auth administrator creation failed'
        admin = result['id']
        initial = json.loads(sql("SELECT json_build_object('role',p.role,'first',p.first_name,'last',p.last_name,"
            "'auth_role',u.raw_app_meta_data->>'streamly_role','auth_first',u.raw_user_meta_data->>'first_name') "
            "FROM profiles p JOIN auth.users u USING(id) WHERE p.id='" + admin + "';"))
        assert initial == {'role': 'admin', 'first': 'Audit', 'last': 'Admin', 'auth_role': 'admin', 'auth_first': 'Audit'}, initial
        pass_check('real Auth admin creation initializes profile/names/server-selected role atomically')

        status, second = http('POST', '/admin/users', {'email': 'backup@audit.example.test',
            'password': 'Fixture-Backup-123', 'email_confirm': True,
            'app_metadata': {'streamly_role': 'admin'}}, service)
        assert status in (200, 201)
        sql("SET request.jwt.claim.sub='" + admin + "'; SELECT set_user_role('" + admin + "','user');")
        assert http('PUT', '/admin/users/' + admin,
            {'app_metadata': {'streamly_role': 'admin', 'fixture_updated': True}}, service)[0] == 200
        assert sql("SELECT role FROM profiles WHERE id='" + admin + "';") == 'user'
        sql("SET request.jwt.claim.sub='" + second['id'] + "'; SELECT set_user_role('" + admin + "','admin');")
        pass_check('later Auth metadata update cannot undo a protected administrator demotion')

        pending = str(uuid.uuid4())
        sql("INSERT INTO pending_registrations(id,email) VALUES('" + pending + "','new@audit.example.test');")
        receipt = json.loads(sql("SET request.jwt.claim.sub='" + admin + "'; SELECT approve_pending_account('" + pending + "');"))
        account = receipt['user_id']
        assert sql("SELECT start_initial_login('new@audit.example.test',repeat('a',64));") == 't'
        assert sql("SELECT claim_initial_password(repeat('a',64));") == account
        pass_check('approved blank-password account receives restricted initial setup capability')
        assert http('POST', '/token?grant_type=password', {'email': 'new@audit.example.test', 'password': ''})[0] == 400
        pass_check('direct Auth blank password cannot bypass initial setup')
        status, _ = http('PUT', '/admin/users/' + account, {'password': 'Fixture-New-123'}, service)
        assert status == 200
        assert sql("SELECT must_change_password::text||':'||(password_set_at IS NOT NULL)::text||':'||(setup_token_hash IS NULL)::text FROM account_activation WHERE user_id='" + account + "';") == 'false:true:true'
        assert sql("SELECT start_initial_login('new@audit.example.test',repeat('b',64));") == 'f'
        pass_check('real Auth password setup updates hash/activation together and permanently blocks blank setup')
        status, session = http('POST', '/token?grant_type=password', {'email': 'new@audit.example.test', 'password': 'Fixture-New-123'})
        assert status == 200 and session.get('access_token')
        token = session['access_token']
        assert http('POST', '/token?grant_type=password', {'email': 'new@audit.example.test', 'password': ''})[0] == 400
        pass_check('new-password HTTP login succeeds; blank HTTP login fails')
        assert http('PUT', '/user', {'data': {'streamly_role': 'admin', 'role': 'admin'}}, token)[0] == 200
        assert sql("SELECT role FROM profiles WHERE id='" + account + "';") == 'user'
        pass_check('client-writable user metadata cannot promote an account to admin')
        assert http('PUT', '/user', {'password': 'Fixture-Changed-456'}, token)[0] == 400
        assert http('PUT', '/user', {'password': 'Fixture-Changed-456', 'current_password': 'Wrong-Fixture-123'}, token)[0] == 400
        assert http('PUT', '/user', {'password': 'Fixture-Changed-456', 'current_password': 'Fixture-New-123'}, token)[0] == 200
        pass_check('normal password change requires correct current password in Auth itself')
        assert http('POST', '/token?grant_type=password', {'email': 'new@audit.example.test', 'password': 'Fixture-New-123'})[0] == 400
        assert http('POST', '/token?grant_type=password', {'email': 'new@audit.example.test', 'password': 'Fixture-Changed-456'})[0] == 200
        pass_check('old password no longer works; changed password works')
        status, _ = http('PUT', '/admin/users/' + account, {'email': 'renamed@audit.example.test', 'email_confirm': True}, service)
        assert status == 200
        assert sql("SELECT email FROM profiles WHERE id='" + account + "';") == 'renamed@audit.example.test'
        pass_check('real Auth email update synchronizes profile login identity')
        sql("UPDATE account_activation SET active=false WHERE user_id='" + account + "';")
        assert http('POST', '/token?grant_type=password', {'email': 'renamed@audit.example.test', 'password': 'Fixture-Changed-456'})[0] >= 400
        pass_check('disabled account cannot obtain an access token through direct Auth login')
        print(str(checks) + ' real Auth checks passed', flush=True)
    finally:
        # Names are generated in this test. Never stop existing production services.
        if made_client: subprocess.run(['docker', 'rm', '-f', client], capture_output=True)
        if made_auth: subprocess.run(['docker', 'rm', '-f', auth], capture_output=True)
        if made_database: subprocess.run(['docker', 'exec', args.container, 'dropdb', '-U', 'supabase_admin', '--force', database], capture_output=True)


if __name__ == '__main__': main()
