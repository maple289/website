"""Read-only container diagnostics; never print environment or raw log output."""
import json
import re
import subprocess


def capture(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=30)
    return result.returncode, result.stdout, result.stderr


for name in ['supabase-rest', 'supabase-kong', 'supabase-db']:
    status, output, _ = capture(['docker', 'inspect', name])
    if status:
        print(name + ': unavailable')
        continue
    container = json.loads(output)[0]
    secrets = []
    for setting in container.get('Config', {}).get('Env', []):
        key, _, value = setting.partition('=')
        if value and re.search(r'(?i)password|secret|token|key|db_uri', key):
            secrets.append(value)

    def sanitize(value):
        text = str(value)
        for secret in sorted(secrets, key=len, reverse=True):
            text = text.replace(secret, '[REDACTED]')
        text = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[JWT REDACTED]', text)
        text = re.sub(r'(?i)(?:postgres(?:ql)?|https?)://[^\s"<>]+', '[URL REDACTED]', text)
        text = re.sub(r'(?i)(password|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+', r'\1=[REDACTED]', text)
        text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[EMAIL REDACTED]', text)
        text = re.sub(r'\b[0-9a-f]{8}-[0-9a-f-]{27,}\b', '[ID REDACTED]', text, flags=re.I)
        text = re.sub(r'\b[0-9a-f]{32,}\b', '[OPAQUE VALUE REDACTED]', text, flags=re.I)
        return text

    state = container.get('State', {})
    print(json.dumps({'container': name, 'status': state.get('Status'),
        'exit_code': state.get('ExitCode'), 'restarts': container.get('RestartCount'),
        'health': state.get('Health', {}).get('Status'), 'error': sanitize(state.get('Error', ''))}))
    print('Container addresses: ' + ', '.join(network.get('IPAddress', '') for network in container.get('NetworkSettings', {}).get('Networks', {}).values()))
    if name == 'supabase-db':
        continue
    _, output, errors = capture(['docker', 'logs', '--tail', '60', name])
    print(name + ' recent log (redacted):')
    for line in (output + errors).splitlines():
        if name == 'supabase-kong' and not re.search(r'(?i)error|warn|failed', line):
            continue
        upstream = re.search(r'upstream:\s*"http://([0-9.]+:[0-9]+)', line)
        if upstream:
            print('Failed upstream address: ' + upstream.group(1))
        print(sanitize(line))
    if name != 'supabase-rest':
        continue
    # Inspect only these non-secret configuration flags.
    settings = dict(item.split('=', 1) for item in container.get('Config', {}).get('Env', []) if '=' in item)
    for key in ['PGRST_DB_CONFIG', 'PGRST_DB_SCHEMAS', 'PGRST_DB_ANON_ROLE', 'PGRST_DB_PRE_REQUEST']:
        print(key + '=' + sanitize(settings.get(key, '(unset)')))

probe = '''import os,requests
for host in ['http://rest:3000','http://kong:8000/rest/v1']:
    key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
    headers={'apikey':key,'Authorization':'Bearer '+key} if 'kong:' in host else {}
    try:
        response=requests.get(host+'/profiles',params={'select':'id','limit':'0'},headers=headers,timeout=10)
        print(host+' status='+str(response.status_code))
    except Exception as error:
        print(host+' error='+type(error).__name__)
'''
status, output, _ = capture(['docker', 'exec', 'supabase-media-worker-1', 'python', '-c', probe])
print(output if status == 0 else 'Internal connectivity probe unavailable')
