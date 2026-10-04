"""Crash recovery and bounded disk-full tests in newly created isolated containers.

Does not restart the production server, database, workers or Docker services.
Only this run's test container and private test volume are removed afterward.
"""
import json
import subprocess
import time
import uuid

run=uuid.uuid4().hex[:10]
container='streamly-audit-db-recovery-'+run
volume='streamly-audit-recovery-data-'+run
made_volume=made_container=False


def command(args,**kwargs):
    return subprocess.run(args,capture_output=True,text=True,check=True,timeout=60,**kwargs).stdout.strip()


def ready():
    for _ in range(50):
        result=subprocess.run(['docker','exec',container,'pg_isready','-U','postgres'],capture_output=True,timeout=5)
        if result.returncode==0: return
        time.sleep(.2)
    raise AssertionError('Isolated recovery database did not start')


def query(source):
    return command(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],input=source)


try:
    command(['docker','volume','create',volume]);made_volume=True
    command(['docker','run','-d','--name',container,'--network','none','--memory','512m','--cpus','1','--pids-limit','128',
        '--mount','type=volume,src='+volume+',dst=/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=isolated-test-only',
        'supabase/postgres:17.6.1.136']);made_container=True
    details=json.loads(command(['docker','inspect',container]))[0]
    assert details['HostConfig']['NetworkMode']=='none' and not details['HostConfig'].get('PortBindings')
    assert all(m['Type']!='bind' for m in details['Mounts'])
    ready()
    query('CREATE TABLE public.audit_recovery(id int PRIMARY KEY); INSERT INTO public.audit_recovery VALUES(1);')
    writer=subprocess.Popen(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-Atq'],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    writer.stdin.write('BEGIN; INSERT INTO public.audit_recovery VALUES(2); SELECT pg_sleep(30) /* audit_crash_marker */; COMMIT;\n');writer.stdin.flush()
    for _ in range(20):
        if query("SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%audit_crash_marker%' AND pid<>pg_backend_pid() AND state='active';")=='1':break
        time.sleep(.1)
    else: raise AssertionError('Interrupted transaction did not start')
    command(['docker','kill','--signal','SIGKILL',container])
    writer.communicate(timeout=10)
    command(['docker','start',container]);ready()
    assert query('SELECT string_agg(id::text,\',\' ORDER BY id) FROM public.audit_recovery;')=='1'
    print('PASS PostgreSQL crash restart preserves committed data and rolls back interrupted transaction',flush=True)
    script="""import subprocess
from pathlib import Path
p=Path('/work/partial.mp4')
r=subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=1280x720:rate=25','-t','5','-c:v','mpeg4','-threads','1','-q:v','2',str(p)],capture_output=True,text=True,timeout=30)
assert r.returncode and 'No space left' in r.stderr, (r.returncode,r.stderr[-500:])
assert p.exists() and p.stat().st_size<=1048576
p.unlink()
print('PASS FFmpeg disk-full failure on isolated 1 MiB scratch; incomplete output removed')
"""
    print(command(['docker','run','--rm','--network','none','--memory','256m','--cpus','1','--pids-limit','128',
        '--tmpfs','/work:rw,uid=10001,gid=10001,size=1m','--entrypoint','python','supabase-media-worker','-c',script]),flush=True)
finally:
    if made_container: command(['docker','rm','-f',container])
    if made_volume: command(['docker','volume','rm',volume])
