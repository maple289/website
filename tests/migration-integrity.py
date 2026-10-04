"""Replay/compare migrations and test rollback/concurrent runners in isolation.

Requires a schema-only baseline produced by pg_dump --schema-only. Never accepts
production containers, network access, production data or filesystem bind mounts.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import re
from pathlib import Path
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prepare',ROOT/'scripts/prepare-migration.py')
prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container',required=True)
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--migrations',type=Path,default=ROOT/'supabase/migrations')
    parser.add_argument('--upgraded',default='audit_test')
    args=parser.parse_args()
    details=json.loads(subprocess.check_output(['docker','inspect',args.container]))[0]
    if not args.container.startswith('streamly-audit-db-') or not args.upgraded.startswith('audit_') or \
        details['HostConfig']['NetworkMode']!='none' or details['HostConfig'].get('Binds') or details['HostConfig'].get('PortBindings'):
        raise SystemExit('Isolated database required')
    fresh='audit_fresh'
    def query(command,database=fresh,fail=False):
        result=subprocess.run(['docker','exec','-i',args.container,'psql','-U','supabase_admin','-d',database,
            '-X','-Atq','-v','ON_ERROR_STOP=1'],input=command,text=True,capture_output=True,timeout=90)
        if fail:
            assert result.returncode,'Expected transaction to fail'
        elif result.returncode: raise AssertionError(result.stderr[-3000:])
        return result.stdout.strip()
    subprocess.run(['docker','exec',args.container,'createdb','-U','supabase_admin','-O','postgres','-T','template0',fresh],check=True)
    query(args.baseline.read_text())
    assert query('SELECT count(*) FROM auth.users;')=='0','Baseline must be schema-only'
    query('DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION pg_database_owner; '
        'GRANT USAGE ON SCHEMA public TO PUBLIC,anon,authenticated,service_role,supabase_auth_admin; '
        'TRUNCATE streamly_internal.schema_migrations; '
        "DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' "
        "LOOP EXECUTE format('DROP POLICY %I ON storage.objects',p.policyname); END LOOP; END $$;")
    # Dropping public also drops Supabase's schema-level default grants. Restore
    # that engine baseline before replaying app migrations with their real role.
    for grant in re.findall(r'^ALTER DEFAULT PRIVILEGES[^;]*;',args.baseline.read_text(),re.M):
        if 'IN SCHEMA public ' in grant: query(grant)
    migrations=sorted(args.migrations.glob('*.sql'))
    for path in migrations:
        try: query('SET ROLE postgres;\n'+prepare.transaction(path.read_text(encoding='utf-8-sig'),path.name))
        except AssertionError as cause: raise AssertionError(path.name+': '+str(cause)) from cause
    print('PASS fresh migration replay: '+str(len(migrations))+' files',flush=True)
    for path in migrations: query('SET ROLE postgres;\n'+prepare.transaction(path.read_text(encoding='utf-8-sig'),path.name))
    print('PASS ledger skips repeated migration execution',flush=True)
    # No top-level internal COMMIT may escape the runner's outer transaction.
    query(prepare.transaction('BEGIN; CREATE TABLE public.audit_atomic(id int); COMMIT; SELECT 1/0;','audit_failure.sql'),fail=True)
    assert query("SELECT to_regclass('public.audit_atomic') IS NULL AND NOT EXISTS(SELECT 1 FROM streamly_internal.schema_migrations WHERE version='audit_failure.sql');")=='t'
    print('PASS failed migration rolls back schema and ledger',flush=True)
    operation=prepare.transaction('BEGIN; CREATE TABLE public.audit_once(id int); COMMIT;','audit_once.sql')
    with ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(query,[operation,operation]))
    assert query("SELECT count(*) FROM streamly_internal.schema_migrations WHERE version='audit_once.sql';")=='1'
    query('DROP TABLE public.audit_once;')
    print('PASS concurrent migrators commit once',flush=True)
    # Compare effective app schema, Auth/Storage policies and cross-schema
    # triggers. Ignore fixture data and ledger contents, never their structure.
    inventory=(ROOT/'scripts/database-audit-inventory.sql').read_text()
    fresh_state=json.loads(query(inventory))
    upgraded=json.loads(query(inventory,args.upgraded))
    differences=[]
    # pg_dump/reparse groups an existing 3-way OR as a flat BoolExpr while SQL
    # replay can retain its nested associative form. Normalize only this known
    # equivalent grouping; never erase arbitrary AND/OR parentheses.
    for state in [fresh_state,upgraded]:
        for policy in state['policies']:
            if policy['policyname']=='user_images_read_public':
                policy['qual']=policy['qual'].replace(
                    '((objects.name = photo.storage_path) OR (objects.name = photo.preview_path)) OR (objects.name = photo.thumbnail_path)',
                    '(objects.name = photo.storage_path) OR (objects.name = photo.preview_path) OR (objects.name = photo.thumbnail_path)')
    for key in ['tables','constraints','indexes','policies','triggers','functions']:
        if fresh_state[key]!=upgraded[key]:
            left={json.dumps(row,sort_keys=True) for row in fresh_state[key]}
            right={json.dumps(row,sort_keys=True) for row in upgraded[key]}
            if left!=right: differences.append({'section':key,'fresh_only':len(left-right),'upgrade_only':len(right-left)})
    if differences: raise AssertionError('Fresh/upgraded schema mismatch: '+json.dumps(differences))
    print('PASS fresh and upgraded effective schemas match',flush=True)


if __name__=='__main__': main()
