"""Run on the backend server. Never prints secrets or raw provider responses."""
import argparse
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--env-file', help='Backend environment file; never a frontend build file')
parser.add_argument('--registration-test', metavar='EMAIL', help='Explicitly submit a real registration request and send its emails')
args = parser.parse_args()
env = dict(os.environ)
if args.env_file:
    for line in Path(args.env_file).read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            env[key.strip()] = value.strip().strip("\"'")
secret = env.get('RESEND_API_KEY', '')
def clean(value):
    text = str(value or '')
    for name in ['RESEND_API_KEY', 'SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SMTP_PASS']:
        if env.get(name):
            text = text.replace(env[name], '[REDACTED]')
    return re.sub(r're_[A-Za-z0-9_-]+', '[REDACTED]', text)[:600]
def request(url, key, body=None, apikey=False):
    headers = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
               'User-Agent': 'Streamly-email-diagnostics/1.0'}
    if apikey:
        headers['apikey'] = key
    req = urllib.request.Request(url, headers=headers, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            data = json.load(error)
        except (ValueError, OSError):
            data = {}
        return error.code, data
    except (OSError, ValueError):
        return 0, {'name': 'transport_error', 'message': 'Request failed; check backend/network logs'}

def report_error(operation, status, data):
    print(json.dumps({'operation': operation, 'status': status, 'type': clean(data.get('name')), 'message': clean(data.get('message'))}))

print('RESEND_API_KEY:', 'configured' if secret else 'missing')
print('Sender:', 'configured' if env.get('RESEND_FROM_EMAIL') or env.get('SMTP_ADMIN_EMAIL') else 'missing')
print('Auth SMTP:', 'configured' if all(env.get(k) for k in ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_ADMIN_EMAIL']) else 'missing/incomplete')
if not secret:
    raise SystemExit('Cannot perform a real Resend send or inspect logs without the server-side key.')
status, domains = request('https://api.resend.com/domains', secret)
if status == 401 and domains.get('name') != 'restricted_api_key':
    print('RESEND_API_KEY: invalid')
if status == 200:
    sender = env.get('RESEND_FROM_EMAIL') or env.get('SMTP_ADMIN_EMAIL') or ''
    match = re.search(r'@([^>\s]+)', sender)
    found = next((d for d in domains.get('data', []) if match and d.get('name') == match[1]), None)
    print('Sender domain:', clean(found.get('status')) if found else 'not found in returned domain page; inspect dashboard')
else:
    report_error('domain_verification', status, domains)
    print('A send-only API key may not permit domain/log reads; that alone does not establish an invalid key.')
if args.registration_test:
    url = (env.get('SUPABASE_PUBLIC_URL') or env.get('API_EXTERNAL_URL') or '').rstrip('/')
    anon = env.get('ANON_KEY', '')
    service = env.get('SERVICE_ROLE_KEY', '')
    if not url or not anon or not service:
        raise SystemExit('Missing backend URL/ANON_KEY/SERVICE_ROLE_KEY for complete registration verification.')
    status, result = request(url + '/functions/v1/notify-admin-registration', anon, {'email': args.registration_test, 'first_name': 'Email test'}, True)
    print('Registration HTTP status:', status)
    query = urllib.parse.urlencode({'email': 'eq.' + args.registration_test, 'select': 'id,status'})
    db_status, rows = request(url + '/rest/v1/pending_registrations?' + query, service, apikey=True)
    if db_status != 200 or not rows:
        raise SystemExit('Could not verify the registration record.')
    print('Registration state:', rows[0]['status'])
    query = urllib.parse.urlencode({'registration_id': 'eq.' + rows[0]['id'], 'select': 'operation,recipient,status,message_id,http_status,error_type,error_message'})
    db_status, rows = request(url + '/rest/v1/registration_email_deliveries?' + query, service, apikey=True)
    if db_status != 200:
        raise SystemExit('Could not read delivery records; check migration/runtime logs.')
    for row in rows:
        print(json.dumps({key: clean(value) for key, value in row.items() if key != 'recipient'}))
    admin_query = urllib.parse.urlencode({'role': 'eq.admin', 'select': 'email'})
    admin_status, admins = request(url + '/rest/v1/profiles?' + admin_query, service, apikey=True)
    expected_admins = {a['email'].strip() for a in admins if a.get('email')} if admin_status == 200 else set()
    notified_admins = {row['recipient'] for row in rows if row['operation'] == 'admin_registration_notification' and row['status'] == 'sent'}
    receipt = any(row['operation'] == 'registration_receipt' and row['status'] == 'sent' for row in rows)
    accepted = receipt and bool(expected_admins) and expected_admins == notified_admins
    print('Applicant and every admin accepted:', 'verified in delivery records' if accepted else 'NOT verified')
    for row in rows:
        if row['status'] != 'sent' or not row.get('message_id'):
            continue
        email_status, email_data = request('https://api.resend.com/emails/' + urllib.parse.quote(row['message_id'], safe=''), secret)
        print(json.dumps({'operation': row['operation'], 'provider_read_status': email_status,
                          'message_id_matches': email_data.get('id') == row['message_id'],
                          'last_event': clean(email_data.get('last_event'))}))
status, logs = request('https://api.resend.com/logs?limit=20', secret)
if status == 200:
    for log in logs.get('data', []):
        if log.get('endpoint') == '/emails' and log.get('method') == 'POST':
            print(json.dumps({key: log.get(key) for key in ['id', 'created_at', 'endpoint', 'method', 'response_status']}))
else:
    report_error('resend_logs', status, logs)
    print('Inspect Resend dashboard Logs with an authorized account if this key lacks read access.')
