"""Read-only post-deployment checks. Output only selected operational fields."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time


def capture(arguments, source=None):
    try:
        result = subprocess.run(arguments, input=source, text=True, capture_output=True, timeout=30)
        return result.returncode, result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return -1, ''


report = {}
code, output = capture(['docker', 'ps', '-a', '--format', '{{.Names}}'])
names = [name for name in output.splitlines() if name.startswith(('supabase-', 'realtime-dev.')) or name == 'streamly-web-1']
code, output = capture(['docker', 'inspect', *names]) if names else (-1, '')
report['containers'] = []
if code == 0:
    for container in json.loads(output):
        state = container.get('State', {})
        report['containers'].append({'name': container['Name'].lstrip('/'), 'state': state.get('Status'),
            'health': state.get('Health', {}).get('Status', 'not_configured'),
            'restarts': container.get('RestartCount'), 'exit_code': state.get('ExitCode'),
            'created_at': container.get('Created'), 'started_at': state.get('StartedAt'),
            'finished_at': state.get('FinishedAt'), 'oom_killed': state.get('OOMKilled')})

metric_format = '{"name":"{{.Name}}","cpu":"{{.CPUPerc}}","memory":"{{.MemUsage}}","memory_percent":"{{.MemPerc}}","pids":"{{.PIDs}}"}'
code, output = capture(['docker', 'stats', '--no-stream', '--format', metric_format, *names]) if names else (-1, '')
report['container_resources'] = [json.loads(line) for line in output.splitlines()] if code == 0 else 'unverified'

report['systemd'] = {}
for unit in ['coturn.service', 'coturn-ip-update.timer']:
    code, output = capture(['systemctl', 'show', unit, '--no-pager', '--property=LoadState,ActiveState,SubState,NRestarts'])
    report['systemd'][unit] = dict(line.split('=', 1) for line in output.splitlines() if '=' in line) if code == 0 else {'status': 'unverified'}
code, output = capture(['systemctl', '--failed', '--no-legend', '--plain', '--no-pager'])
report['failed_systemd_units'] = [line.split()[0] for line in output.splitlines() if line.strip()] if code == 0 else 'unverified'

report['disk'] = {}
for directory in ['/', '/srv/streamly/supabase/volumes/storage']:
    try:
        usage = shutil.disk_usage(directory)
        report['disk'][directory] = {'total_gib': round(usage.total / 2**30, 2),
            'free_gib': round(usage.free / 2**30, 2), 'used_percent': round(100 * usage.used / usage.total, 2)}
    except OSError:
        report['disk'][directory] = 'unverified'
memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
report['memory'] = {key + '_gib': round(int(memory[key].split()[0]) / 2**20, 2) for key in ['MemTotal', 'MemAvailable']}
report['logical_cpus'] = os.cpu_count()

def cpu_sample():
    values = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:]]
    return sum(values[:8]), values[3] + values[4]

total, idle = cpu_sample()
time.sleep(0.5)
next_total, next_idle = cpu_sample()
report['cpu_busy_percent'] = round(100 * (1 - (next_idle - idle) / max(1, next_total - total)), 2)
report['uptime_hours'] = round(float(Path('/proc/uptime').read_text().split()[0]) / 3600, 2)

# This transaction reads only catalog metadata and an aggregate administrator count.
query = '''BEGIN READ ONLY;
SELECT json_build_object(
 'active_administrators',(SELECT count(*) FROM public.profiles WHERE role='admin' AND public.active_account(id)),
 'account_guard_on_storage',(SELECT count(*)=1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='active_account_required'),
 'rest_account_hook',(SELECT EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) setting WHERE s.setrole='authenticator'::regrole AND setting='pgrst.db_pre_request=public.enforce_active_account')),
 'temporary_password_issuer_installed',(SELECT to_regprocedure('public.issue_initial_temporary_password(text,text,uuid)') IS NOT NULL),
 'temporary_password_service_only',(SELECT NOT has_function_privilege('anon','public.issue_initial_temporary_password(text,text,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.issue_initial_temporary_password(text,text,uuid)','EXECUTE')),
 'new_migrations_recorded',(SELECT count(*) FROM streamly_internal.schema_migrations WHERE version IN (
  '20261012010000_account_security_boundaries.sql','20261012020000_guard_storage_prefix_changes.sql',
  '20261012030000_reauthorized_video_playback.sql','20261012040000_durable_file_transfers.sql',
  '20261012050000_initial_temporary_password.sql')));
COMMIT;'''
code, output = capture(['docker', 'exec', '-i', 'supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], query)
try:
    report['database_checks'] = json.loads(output.strip()) if code == 0 else 'unverified'
except ValueError:
    report['database_checks'] = 'unverified'
print(json.dumps(report, indent=2))
