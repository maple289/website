"""Operator-run root helper. Changes authentication only, never networking.

prepare: backs up and writes backend secret; coturn remains unchanged.
activate: switches coturn after backend deployment, rolls back on local failure.
rollback: restores prior auth while retaining the latest dynamic external-ip.
Secrets never leave protected server files. Run from the staged server folder.
"""
from pathlib import Path
import datetime, grp, hashlib, hmac, importlib.util, json, os, re, shutil, subprocess, sys, tempfile, time

CONFIG = Path('/etc/turnserver.conf')
ENV = Path('/srv/streamly/supabase/.env')
STATE = Path('/var/lib/streamly-turn-integration')
STATUS = Path('/home/vlad/turn-integration/auth-status.json')
UPDATER = [Path('/usr/local/sbin/update-coturn-ip.sh'), Path('/etc/systemd/system/coturn-ip-update.service'), Path('/etc/systemd/system/coturn-ip-update.timer')]

def directives(text):
    return {line.split('=', 1)[0].strip(): line.partition('=')[2].strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')}

def write(path, text, mode, uid, gid):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        os.fchmod(fd, mode); os.fchown(fd, uid, gid)
        with os.fdopen(fd, 'w') as stream:
            stream.write(text); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

def backup(path, destination):
    shutil.copy2(path, destination); os.chmod(destination, 0o600); os.chown(destination, 0, 0)

def publish(state, result):
    public = {key: state[key] for key in ['config_backup', 'environment_backup', 'prepared_at']}
    public['status'] = result
    write(STATUS, json.dumps(public, indent=2), 0o644, 0, 0)
    print(json.dumps(public))

def auth_config(text, secret):
    auth = {'user', 'lt-cred-mech', 'use-auth-secret', 'static-auth-secret', 'no-auth', 'oauth', 'rest-api-separator'}
    lines = [line for line in text.splitlines() if line.lstrip().startswith('#') or line.split('=', 1)[0].strip() not in auth]
    return '\n'.join(lines) + '\nuse-auth-secret\nstatic-auth-secret=' + secret + '\n'

def restart():
    subprocess.run(['systemctl', 'restart', 'coturn'], check=True, capture_output=True)
    if subprocess.run(['systemctl', 'is-active', '--quiet', 'coturn']).returncode: raise RuntimeError('coturn_not_active')

def restore(state):
    # Preserve any ISP update that occurred since backup creation.
    current = directives(CONFIG.read_text()).get('external-ip')
    saved = Path(state['config_backup']).read_text()
    if current: saved = re.sub(r'^\s*external-ip=.*$', 'external-ip=' + current, saved, flags=re.M)
    write(CONFIG, saved, 0o640, 0, grp.getgrnam('turnserver').gr_gid)
    restart(); publish(state, 'rolled_back')

def main():
    if os.geteuid() != 0: raise RuntimeError('run_with_sudo_in_server_terminal')
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    if action not in ['prepare', 'activate', 'rollback']: raise RuntimeError('choose_prepare_activate_or_rollback')
    STATE.mkdir(mode=0o700, exist_ok=True); os.chmod(STATE, 0o700)
    ledger = STATE / 'state.json'
    text = CONFIG.read_text(); settings = directives(text)
    expected = {'listening-ip': '192.168.1.191', 'relay-ip': '192.168.1.191', 'min-port': '50000', 'max-port': '50100', 'realm': 'myhostage.ca'}
    if any(settings.get(k) != v for k, v in expected.items()) or not all(k in settings for k in ['fingerprint', 'no-tls', 'no-dtls', 'external-ip']):
        raise RuntimeError('existing_network_configuration_differs_stop_without_changes')
    if action == 'prepare':
        if ledger.exists():
            publish(json.loads(ledger.read_text()), 'already_prepared'); return
        if 'use-auth-secret' in settings: raise RuntimeError('existing_rest_auth_requires_review')
        timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
        state = {'config_backup': '/etc/turnserver.conf.before-rest-auth-' + timestamp,
                 'environment_backup': str(STATE / ('runtime-env-' + timestamp + '.backup')),
                 'prepared_at': timestamp, 'updater_hashes': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in UPDATER}}
        backup(CONFIG, Path(state['config_backup'])); backup(ENV, Path(state['environment_backup']))
        if not Path('/etc/turnserver.conf.working').exists(): backup(CONFIG, Path('/etc/turnserver.conf.working'))
        secret = subprocess.check_output(['openssl', 'rand', '-hex', '32'], text=True).strip()
        if not re.fullmatch('[0-9a-f]{64}', secret): raise RuntimeError('random_secret_generation_failed')
        original = ENV.stat(); names = {'TURN_SHARED_SECRET', 'TURN_AUTH_SECRET', 'TURN_URLS', 'STUN_URLS'}
        lines = [line for line in ENV.read_text().splitlines() if line.split('=', 1)[0].strip() not in names]
        lines += ['TURN_SHARED_SECRET=' + secret,
                  'TURN_URLS=turn:myhostage.ca:3478?transport=udp,turn:myhostage.ca:3478?transport=tcp', 'STUN_URLS=stun:myhostage.ca:3478']
        write(ENV, '\n'.join(lines) + '\n', 0o600, original.st_uid, original.st_gid)
        write(ledger, json.dumps(state), 0o600, 0, 0); publish(state, 'prepared_coturn_unchanged'); return
    if not ledger.exists(): raise RuntimeError('prepare_first')
    state = json.loads(ledger.read_text())
    if action == 'rollback': restore(state); return
    if any(hashlib.sha256(Path(p).read_bytes()).hexdigest() != digest for p, digest in state['updater_hashes'].items()):
        raise RuntimeError('updater_changed_requires_review')
    env = directives(ENV.read_text()); secret = env.get('TURN_SHARED_SECRET', '')
    if not re.fullmatch('[0-9a-f]{64}', secret): raise RuntimeError('backend_secret_missing')
    # Refuse to switch until the running backend has this exact secret and URLs.
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'supabase-edge-functions']))[0]
    running = dict(v.split('=', 1) for v in container['Config']['Env'] if '=' in v)
    if not hmac.compare_digest(running.get('TURN_SHARED_SECRET', ''), secret) or running.get('TURN_URLS') != env['TURN_URLS']:
        raise RuntimeError('deploy_backend_with_prepared_environment_before_activation')
    try:
        write(CONFIG, auth_config(text, secret), 0o640, 0, grp.getgrnam('turnserver').gr_gid)
        restart()
        spec = importlib.util.spec_from_file_location('turn_probe', Path(__file__).with_name('turn-allocation-check.py'))
        probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)
        username = str(int(time.time()) + 3600) + ':integration-validation'
        credential = __import__('base64').b64encode(hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
        results = [probe.allocate('192.168.1.191', 3478, transport, username, credential) for transport in ['udp', 'tcp']]
        if any(not 50000 <= result['relay_port'] <= 50100 for result in results): raise RuntimeError('unexpected_relay_range')
        if subprocess.run(['systemctl', 'is-active', '--quiet', 'coturn-ip-update.timer']).returncode: raise RuntimeError('ip_timer_not_active')
        publish(state, 'active_rest_auth_local_allocations_passed'); print(json.dumps({'local_allocations': results}))
    except Exception:
        restore(state)
        raise RuntimeError('activation_failed_automatically_restored_previous_coturn_auth') from None

if __name__ == '__main__':
    try: main()
    except Exception as cause:
        print(json.dumps({'status': 'failed', 'category': str(cause) if isinstance(cause, RuntimeError) else type(cause).__name__}))
        sys.exit(1)
