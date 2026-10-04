"""Real PostgreSQL workflow/concurrency tests, restricted to an isolated container.

Run against a schema-only clone: python tests/database-integrity.py --container
streamly-audit-db-20261003 --database audit_test. No production data is copied.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import unittest
import uuid

CONTAINER = ''
DATABASE = ''
ADMIN = '11111111-1111-4111-8111-111111111111'
OWNER = '22222222-2222-4222-8222-222222222222'
OTHER = '33333333-3333-4333-8333-333333333333'
VIDEO = '44444444-4444-4444-8444-444444444444'
PHOTO = '55555555-5555-4555-8555-555555555555'


def sql(command, actor=None, role='authenticated', failure=False):
    prefix = "LOAD 'safeupdate'; SET statement_timeout='15s'; "
    if actor is not None:
        prefix += "SET ROLE " + role + "; SET request.jwt.claim.sub='" + actor + "'; "
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'supabase_admin',
        '-d', DATABASE, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=prefix + command,
        text=True, capture_output=True, timeout=45)
    if failure:
        if not result.returncode: raise AssertionError('Unauthorized/invalid operation unexpectedly succeeded')
        return result.stderr
    if result.returncode: raise AssertionError(result.stderr[-2500:])
    value = result.stdout.strip().splitlines()
    return value[-1] if value else ''


def object_row(path, bucket='user-files', object_id=None):
    object_id = object_id or str(uuid.uuid4())
    sql("INSERT INTO storage.objects(id,bucket_id,name,version,metadata) VALUES ('" + object_id + "','" + bucket + "','" + path +
        "','test-version','{\"size\":16,\"mimetype\":\"application/octet-stream\"}');")
    return object_id


def remove_object(path, bucket='user-files'):
    # Storage API sets this only for its catalog transaction after physical
    # removal. We simulate that catalog phase solely in the empty isolated DB.
    sql("SET storage.allow_delete_query='true'; DELETE FROM storage.objects WHERE bucket_id='" + bucket + "' AND name='" + path + "';")


class IntegrityWorkflows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sql("""INSERT INTO storage.buckets(id,name,public) VALUES
          ('user-files','user-files',false),('user-videos','user-videos',false),
          ('user-images','user-images',false),('media-staging','media-staging',false),
          ('file-previews','file-previews',false) ON CONFLICT DO NOTHING;
          INSERT INTO storage_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
          INSERT INTO analytics_config DEFAULT VALUES;
        """)
        for identity, name in [(ADMIN, 'admin'), (OWNER, 'owner'), (OTHER, 'other')]:
            sql("INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at,raw_user_meta_data) VALUES ('" + identity +
                "','" + name + "@audit.example.test',extensions.crypt('Fixture-Password-1',extensions.gen_salt('bf')),now(),'{}');")
        sql("UPDATE profiles SET role='admin' WHERE id='" + ADMIN + "';")
        object_row(OWNER + '/videos/' + VIDEO + '/original.mp4', 'user-videos')
        object_row(OWNER + '/videos/' + VIDEO + '/stream.mp4', 'user-videos')
        sql("INSERT INTO videos(id,owner_id,file_name,storage_path,processed_storage_path,processing_status,visibility) VALUES ('" +
            VIDEO + "','" + OWNER + "','Audit video','" + OWNER + '/videos/' + VIDEO + "/original.mp4','" + OWNER +
            '/videos/' + VIDEO + "/stream.mp4','ready','public');")
        for name in ['original.jpg','preview.webp','thumbnail.webp']:
            object_row(OWNER + '/photos/' + PHOTO + '/' + name, 'user-images')
        sql("INSERT INTO photos(id,owner_id,file_name,storage_path,preview_path,thumbnail_path,mime_type,visibility) VALUES ('" +
            PHOTO + "','" + OWNER + "','Audit photo','" + OWNER + '/photos/' + PHOTO + "/original.jpg','" + OWNER +
            '/photos/' + PHOTO + "/preview.webp','" + OWNER + '/photos/' + PHOTO + "/thumbnail.webp','image/jpeg','public');")

    def test_01_registration_approval_concurrent_and_password_setup(self):
        registration = str(uuid.uuid4())
        sql("INSERT INTO pending_registrations(id,email) VALUES ('" + registration + "','new@audit.example.test');")
        operation = "SELECT approve_pending_account('" + registration + "');"
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: json.loads(sql(operation, ADMIN)), range(2)))
        self.assertEqual(results[0]['user_id'], results[1]['user_id'])
        account = results[0]['user_id']
        self.assertEqual(sql("SELECT count(*) FROM pending_registrations WHERE id='" + registration + "';"), '0')
        self.assertEqual(sql("SELECT p.role||':'||must_change_password::text||':'||(encrypted_password IS NULL)::text FROM profiles p JOIN auth.users u USING(id) JOIN account_activation a ON a.user_id=p.id WHERE p.id='" + account + "';"), 'user:true:true')
        self.assertEqual(sql("SELECT start_initial_login('new@audit.example.test',repeat('a',64));"), 't')
        self.assertEqual(sql("SELECT claim_initial_password(repeat('a',64));"), account)
        self.assertEqual(sql("SELECT claim_initial_password(repeat('a',64)) IS NULL;"), 't')
        sql("UPDATE auth.users SET encrypted_password=extensions.crypt('Fixture-New-Password-2',extensions.gen_salt('bf')) WHERE id='" + account + "';")
        self.assertEqual(sql("SELECT must_change_password OR password_set_at IS NULL OR setup_token_hash IS NOT NULL FROM account_activation WHERE user_id='" + account + "';"), 'f')
        self.assertEqual(sql("SELECT start_initial_login('new@audit.example.test',repeat('b',64));"), 'f')
        self.assertEqual(sql("SELECT encrypted_password=extensions.crypt('Fixture-New-Password-2',encrypted_password) AND encrypted_password<>extensions.crypt('Fixture-Password-1',encrypted_password) FROM auth.users WHERE id='" + account + "';"), 't')
        duplicate = str(uuid.uuid4())
        sql("INSERT INTO pending_registrations(id,email) VALUES ('" + duplicate + "','NEW@audit.example.test');")
        sql("SELECT approve_pending_account('" + duplicate + "');", ADMIN, failure=True)
        self.assertEqual(sql("SELECT count(*) FROM pending_registrations WHERE id='" + duplicate + "';"), '1')
        rejected = str(uuid.uuid4())
        sql("INSERT INTO pending_registrations(id,email,status) VALUES ('" + rejected + "','rejected@audit.example.test','rejected');")
        sql("SELECT approve_pending_account('" + rejected + "');", ADMIN, failure=True)
        sql(operation, OWNER, failure=True)
        interrupted=str(uuid.uuid4())
        sql("INSERT INTO pending_registrations(id,email) VALUES('"+interrupted+"','rollback@audit.example.test'); "
            "CREATE FUNCTION public.audit_approval_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.email='rollback@audit.example.test' THEN RAISE EXCEPTION 'simulated database failure'; END IF; RETURN NEW; END $$; "
            "CREATE TRIGGER audit_approval_failure AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.audit_approval_failure();")
        try:
            sql("SELECT approve_pending_account('"+interrupted+"');",ADMIN,failure=True)
            self.assertEqual(sql("SELECT count(*) FROM pending_registrations WHERE id='"+interrupted+"';"),'1')
            self.assertEqual(sql("SELECT count(*) FROM auth.users WHERE email='rollback@audit.example.test';"),'0')
        finally: sql('DROP TRIGGER audit_approval_failure ON auth.users; DROP FUNCTION public.audit_approval_failure();')

    def test_02_roles_and_profile_permissions(self):
        sql("SELECT set_user_role('" + OTHER + "','admin');", ADMIN)
        sql("SELECT set_user_role('" + OTHER + "','user');", ADMIN)
        self.assertEqual(sql("SELECT role FROM profiles WHERE id='" + OTHER + "';"), 'user')
        sql("SELECT set_user_role('" + OTHER + "','admin');", OWNER, failure=True)
        sql("SELECT update_profile_names('First',NULL);", OWNER)
        self.assertEqual(sql("SELECT first_name||':'||(last_name IS NULL)::text FROM profiles WHERE id='" + OWNER + "';"), 'First:true')
        sql("SELECT set_user_role('" + ADMIN + "','user');", ADMIN, failure=True)
        sql("UPDATE auth.users SET email='renamed@audit.example.test' WHERE id='" + OWNER + "';")
        self.assertEqual(sql("SELECT email FROM profiles WHERE id='" + OWNER + "';"), 'renamed@audit.example.test')
        duplicate=str(uuid.uuid4())
        sql("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('"+duplicate+"','RENAMED@audit.example.test','{}');",failure=True)
        self.assertEqual(sql("SELECT count(*) FROM auth.users WHERE id='"+duplicate+"';"),'0')
        sql("INSERT INTO pending_registrations(email,status) VALUES('invalid@audit.example.test','invalid');", failure=True)
        self.assertEqual(sql("WITH changed AS(UPDATE profiles SET role='admin' WHERE id='"+OWNER+"' RETURNING id) SELECT count(*) FROM changed;",OWNER),'0')
        sql("SELECT set_user_role('"+OWNER+"','admin');",ADMIN)
        def demote(pair):
            try: sql("SELECT set_user_role('"+pair[1]+"','user');",pair[0]); return True
            except AssertionError: return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            result=list(pool.map(demote,[(ADMIN,OWNER),(OWNER,ADMIN)]))
        self.assertEqual(sum(result),1)
        self.assertEqual(sql("SELECT count(*) FROM profiles WHERE role='admin';"),'1')
        sql("UPDATE profiles SET role='admin' WHERE id='"+ADMIN+"'; UPDATE profiles SET role='user' WHERE id='"+OWNER+"';")
        fixture=str(uuid.uuid4())
        sql("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('"+fixture+"','spoof@audit.example.test','{\"streamly_role\":\"admin\"}');")
        self.assertEqual(sql("SELECT role FROM profiles WHERE id='"+fixture+"';"),'user')

    def test_03_media_ownership_visibility_rename_and_reactions(self):
        sql("UPDATE photos SET file_name='Renamed audit photo',visibility='private' WHERE id='" + PHOTO + "';", OWNER)
        self.assertEqual(sql("SELECT count(*) FROM photos WHERE id='" + PHOTO + "';", OTHER), '0')
        sql("SELECT set_media_reaction('photo','" + PHOTO + "','love');", OTHER, failure=True)
        sql("UPDATE photos SET owner_id='" + OTHER + "' WHERE id='" + PHOTO + "';", OWNER, failure=True)
        sql("UPDATE photos SET visibility='public' WHERE id='" + PHOTO + "';", OWNER)
        def react(actor): sql("SELECT set_media_reaction('photo','" + PHOTO + "','love');", actor)
        with ThreadPoolExecutor(max_workers=3) as pool: list(pool.map(react, [OWNER, OWNER, OTHER]))
        self.assertEqual(sql("SELECT count(*) FROM media_reactions WHERE photo_id='" + PHOTO + "';"), '2')
        sql("SELECT set_media_reaction('photo','" + PHOTO + "','like');", OWNER)
        self.assertEqual(sql("SELECT reaction FROM media_reactions WHERE photo_id='" + PHOTO + "' AND user_id='" + OWNER + "';"), 'like')
        sql("SELECT set_media_reaction('photo','" + PHOTO + "',NULL);", OWNER)
        self.assertEqual(sql("SELECT count(*) FROM media_reactions WHERE photo_id='" + PHOTO + "' AND user_id='" + OWNER + "';"), '0')
        sql("SELECT set_media_reaction('photo','" + PHOTO + "','like');", '', 'anon', failure=True)
        sql("INSERT INTO media_reactions(user_id,media_type,media_id,reaction) VALUES ('" + OWNER + "','photo',gen_random_uuid(),'like');", failure=True)

    def test_04_file_sharing_public_scope_and_recipient_cascade(self):
        path = OWNER + '/Audit Folder'
        child = path + '/nested/report.docx'
        object_row(path + '/.folder')
        object_row(child)
        sql("INSERT INTO user_file_metadata(owner_id,object_path,is_folder,file_size,mime_type) VALUES ('" + OWNER + "','" + path +
            "',true,0,''),('" + OWNER + "','" + child + "',false,16,'application/octet-stream') ON CONFLICT DO NOTHING;")
        sql("SELECT set_user_file_sharing('" + path + "',ARRAY['" + OTHER + "']::uuid[],false);", OWNER)
        self.assertEqual(sql("SELECT count(*) FROM storage.objects WHERE bucket_id='user-files' AND name='" + child + "';", OTHER), '1')
        sql("SELECT set_user_file_sharing('" + path + "',ARRAY[]::uuid[],false);", OTHER, failure=True)
        self.assertEqual(sql("SELECT count(*) FROM storage.objects WHERE bucket_id='user-files' AND name='" + child + "';", '', 'anon'), '0')
        sql("SELECT set_user_file_sharing('" + path + "',ARRAY[]::uuid[],true);", OWNER)
        public_id = sql("SELECT public_id FROM user_file_metadata WHERE object_path='" + child + "';")
        self.assertEqual(sql("SELECT resolve_public_user_file('" + public_id + "')='" + child + "';"), 't')
        sql("SELECT set_user_file_sharing('" + path + "',ARRAY[]::uuid[],false);", OWNER)
        self.assertEqual(sql("SELECT resolve_public_user_file('" + public_id + "') IS NULL;"), 't')
        operations=["SELECT set_user_file_sharing('"+path+"',ARRAY[]::uuid[],true);", "SELECT set_user_file_sharing('"+path+"',ARRAY[]::uuid[],false);"]
        with ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(lambda operation:sql(operation,OWNER),operations))
        self.assertLessEqual(int(sql("SELECT count(*) FROM user_file_shares WHERE object_path='"+path+"';")),1)
        sql("SELECT set_user_file_sharing('" + path + "',ARRAY['" + OTHER + "']::uuid[],false);", OWNER)
        sql("DELETE FROM auth.users WHERE id='" + OTHER + "';")
        self.assertEqual(sql("SELECT count(*) FROM user_file_shares WHERE recipient_id='" + OTHER + "';"), '0')

    def test_05_views_atomic_idempotent_and_statistics_scope(self):
        # Anonymous viewers have no stored identity. Each distinct request counts.
        requests = [str(uuid.uuid4()) for _ in range(12)]
        def view(request): sql("SELECT analytics_record('video','view','" + request + "','" + VIDEO + "');", '', 'anon')
        with ThreadPoolExecutor(max_workers=4) as pool: list(pool.map(view, requests))
        view(requests[0])
        self.assertEqual(sql("SELECT views FROM analytics_content WHERE video_id='" + VIDEO + "';"), '12')
        self.assertEqual(sql("SELECT count(*) FROM analytics_events WHERE content_id='" + VIDEO + "';"), '12')
        sql("SELECT analytics_record('video','view',gen_random_uuid(),'"+VIDEO+"');",OWNER)
        sql("SELECT analytics_record('video','view',gen_random_uuid(),'"+VIDEO+"');",OWNER)
        self.assertEqual(sql("SELECT views FROM analytics_content WHERE video_id='"+VIDEO+"';"),'13')
        self.assertEqual(sql("SELECT count(*) FROM analytics_viewers WHERE content_type='video' AND content_id='"+VIDEO+"';"),'1')
        sql("SELECT admin_analytics();", OWNER, failure=True)
        dashboard = json.loads(sql("SELECT user_analytics();", OWNER))
        self.assertNotIn('storage', dashboard)
        self.assertNotIn('storage_by_user', dashboard)
        self.assertNotIn('user', dashboard)
        self.assertNotIn('users', dashboard['overview'])
        sql("SELECT user_analytics();", '', 'anon', failure=True)
        sql("SELECT user_analytics(p_owner=>'" + ADMIN + "');", OWNER, failure=True)

    def test_06_preview_queue_version_size_and_cancellation(self):
        path = OWNER + '/preview-source.docx'
        source = object_row(path)
        descriptor = json.loads(sql("SELECT get_file_preview_source('" + path + "');"))
        operation = "SELECT queue_file_preview('" + source + "','" + descriptor['version'] + "','docx');"
        with ThreadPoolExecutor(max_workers=2) as pool:
            rows = list(pool.map(lambda _: json.loads(sql(operation)), range(2)))
        self.assertEqual(rows[0]['id'], rows[1]['id'])
        self.assertNotEqual(sql('SELECT count(*) FROM claim_file_preview();'), '0')
        self.assertEqual(sql('SELECT count(*) FROM claim_file_preview();'), '0')
        sql("UPDATE storage.objects SET name='" + OWNER + "/preview-renamed.docx' WHERE id='" + source + "';")
        self.assertEqual(sql("SELECT count(*) FROM file_preview_jobs WHERE source_id='" + source + "';"), '0')
        self.assertEqual(sql("SELECT count(*) FROM file_preview_cleanup WHERE path='" + rows[0]['preview_path'] + "';"), '1')
        sql(operation, failure=True)
        sql("UPDATE storage.objects SET metadata='{\"size\":31457280}' WHERE id='" + source + "';")
        descriptor = json.loads(sql("SELECT get_file_preview_source('" + OWNER + "/preview-renamed.docx');"))
        sql("SELECT queue_file_preview('" + source + "','" + descriptor['version'] + "','docx');", failure=True)

    def test_07_video_cancellation_retry_and_late_publish(self):
        job = str(uuid.uuid4())
        object_row(OWNER + '/' + job + '/source', 'media-staging')
        sql("SELECT queue_media_upload('" + job + "','" + OWNER + "','video','Failure fixture','private');")
        sql("UPDATE media_upload_jobs SET status='processing',started_at=now() WHERE id='" + job + "';")
        self.assertEqual(sql("SELECT begin_video_deletion('" + job + "','" + OWNER + "');"), 'f')
        sql("UPDATE media_upload_jobs SET status='complete' WHERE id='" + job + "';")
        self.assertEqual(sql("SELECT status FROM media_upload_jobs WHERE id='" + job + "';"), 'cancelling')
        sql("SELECT finish_video_deletion('" + job + "','" + OWNER + "');", failure=True)
        sql("UPDATE media_upload_jobs SET status='cancelled' WHERE id='" + job + "';")
        remove_object(OWNER + '/' + job + '/source', 'media-staging')
        sql("SELECT finish_video_deletion('" + job + "','" + OWNER + "');")
        sql("SELECT finish_video_deletion('" + job + "','" + OWNER + "');")
        sql("INSERT INTO media_upload_jobs(id,owner_id,kind,file_name,visibility) VALUES ('" + job + "','" + OWNER + "','video','late','private');", failure=True)
        sql("SELECT retry_video_processing('" + job + "');", OWNER, failure=True)

    def test_08_delete_cascades_and_cache_with_safeupdate(self):
        sql("INSERT INTO analytics_cache(key,expires_at,data) VALUES ('audit-test',now()+interval '1 hour','{}') ON CONFLICT DO NOTHING;")
        sql("DELETE FROM photos WHERE id='" + PHOTO + "';", OWNER)
        self.assertEqual(sql("SELECT count(*) FROM analytics_content WHERE photo_id='" + PHOTO + "';"), '0')
        self.assertEqual(sql("SELECT count(*) FROM media_reactions WHERE photo_id='" + PHOTO + "';"), '0')
        self.assertEqual(sql("SELECT count(*) FROM analytics_cache WHERE key='audit-test';"), '0')
        # Physical Storage removal is exercised separately by worker fault tests.
        sql("DELETE FROM videos WHERE id='" + VIDEO + "';", OWNER, failure=True)

    def test_09_file_catalog_atomicity_and_rename_shares(self):
        path=OWNER+'/atomic.txt'; source=object_row(path)
        self.assertEqual(sql("SELECT source_id FROM user_file_metadata WHERE object_path='"+path+"';"),source)
        sql("SELECT set_user_file_sharing('"+path+"',ARRAY[]::uuid[],true);",OWNER)
        next_path=OWNER+'/atomic-renamed.txt'
        sql("UPDATE storage.objects SET name='"+next_path+"' WHERE id='"+source+"';")
        self.assertEqual(sql("SELECT object_path FROM user_file_shares WHERE owner_id='"+OWNER+"' AND object_path='"+next_path+"';"),next_path)
        sql("BEGIN; INSERT INTO storage.objects(bucket_id,name) VALUES('user-files','"+OWNER+"/rolled-back.txt'); SELECT 1/0; COMMIT;",failure=True)
        self.assertEqual(sql("SELECT count(*) FROM user_file_metadata WHERE object_path='"+OWNER+"/rolled-back.txt';"),'0')
        sql("INSERT INTO user_file_metadata(owner_id,object_path) VALUES('"+OWNER+"','"+OWNER+"/nonexistent.txt');",OWNER,failure=True)
        for invalid in ['/../escape.txt','/./escape.txt','//escape.txt','/a/../../escape.txt']:
            sql("INSERT INTO storage.objects(bucket_id,name) VALUES('user-files','"+OWNER+invalid+"');",failure=True)
        remove_object(next_path)
        self.assertEqual(sql("SELECT count(*) FROM user_file_metadata WHERE source_id='"+source+"';"),'0')
        self.assertEqual(sql("SELECT count(*) FROM user_file_shares WHERE object_path='"+next_path+"';"),'0')
        self.assertEqual(sql("SELECT count(*) FROM file_manager_metadata(p_folder=>'../../other-account',p_view=>'files');",OWNER),'0')
        sql("SELECT file_manager_storage_bytes();",'', 'anon',failure=True)

    def test_10_media_claim_fencing_and_atomic_publication(self):
        job=str(uuid.uuid4()); object_row(OWNER+'/'+job+'/source','media-staging')
        sql("SELECT queue_media_upload('"+job+"','"+OWNER+"','video','Publication fixture','private');")
        with ThreadPoolExecutor(max_workers=2) as pool:
            claims=list(pool.map(lambda _:json.loads(sql("SELECT coalesce(jsonb_agg(j),'[]') FROM claim_media_uploads(1) j;")),range(2)))
        claimed=[item for batch in claims for item in batch]
        self.assertEqual(len(claimed),1); old=claimed[0]['claim_token']
        base=OWNER+'/videos/'+job
        preview=OWNER+'/video-previews/'+job+'/preview.webp'
        record=dict(id=job,owner_id=OWNER,owner_email='fixture@audit.example.test',file_name='Publication fixture',visibility='private',
            file_size=16,mime_type='video/mp4',storage_path=base+'/original.mp4',processed_storage_path=base+'/stream.mp4',
            preview_path=preview,processing_status='ready',processed_file_size=16,video_codec='h264',container_format='mov')
        def publish(token, failure=False):
            return sql("SELECT publish_media_upload('"+job+"','"+token+"','"+json.dumps(record)+"');",failure=failure)
        publish(old,True)  # Missing verified Storage output cannot become Ready.
        self.assertEqual(sql("SELECT count(*) FROM videos WHERE id='"+job+"';"),'0')
        sql("UPDATE media_upload_jobs SET started_at=now()-interval '4 hours' WHERE id='"+job+"';")
        sql('SELECT count(*) FROM claim_media_uploads(0);')
        self.assertEqual(sql("SELECT status FROM media_upload_jobs WHERE id='"+job+"';"),'error')
        sql("SELECT retry_video_processing('"+job+"');",OWNER)
        new=json.loads(sql('SELECT to_jsonb(j) FROM claim_media_uploads(1) j;'))['claim_token']
        self.assertNotEqual(old,new)
        for path in [base+'/original.mp4',base+'/stream.mp4']: object_row(path,'user-videos')
        object_row(preview,'user-images')
        publish(old,True)
        self.assertEqual(json.loads(publish(new))['id'],job)
        self.assertEqual(json.loads(publish(new))['id'],job)  # Lost-response retry is idempotent.
        self.assertEqual(sql("SELECT count(*) FROM videos WHERE id='"+job+"';"),'1')
        self.assertEqual(sql("SELECT status FROM media_upload_jobs WHERE id='"+job+"';"),'complete')
        sql("SELECT publish_media_upload('"+job+"','"+new+"','{}');",OWNER,failure=True)

    def test_11_photo_and_custom_preview_publication(self):
        for kind in ['photo','preview']:
            job=str(uuid.uuid4()); object_row(OWNER+'/'+job+'/source','media-staging')
            extra=",false,'"+VIDEO+"'" if kind=='preview' else ''
            sql("SELECT queue_media_upload('"+job+"','"+OWNER+"','"+kind+"','New photo fixture','private'"+extra+");")
            claim=json.loads(sql('SELECT to_jsonb(j) FROM claim_media_uploads(1) j;'))['claim_token']
            if kind=='photo':
                base=OWNER+'/photos/'+job
                for name in ['original.jpg','preview.webp','thumbnail.webp']: object_row(base+'/'+name,'user-images')
                record=dict(id=job,owner_id=OWNER,owner_email='fixture@audit.example.test',file_name='New photo fixture',visibility='private',
                    storage_path=base+'/original.jpg',preview_path=base+'/preview.webp',thumbnail_path=base+'/thumbnail.webp',
                    mime_type='image/jpeg',width=64,height=48,file_size=16)
            else:
                record={'path':OWNER+'/video-previews/'+VIDEO+'/'+job+'.webp'}
                object_row(record['path'],'user-images')
            result=json.loads(sql("SELECT publish_media_upload('"+job+"','"+claim+"','"+json.dumps(record)+"');"))
            self.assertEqual(sql("SELECT status FROM media_upload_jobs WHERE id='"+job+"';"),'complete')
            if kind=='photo': self.assertEqual(result['id'],job)
            else:
                sql("UPDATE videos SET preview_path='"+result['path']+"' WHERE id='"+VIDEO+"';",OWNER)

    def test_12_unpublished_cleanup_is_limited_to_new_failed_uploads(self):
        job=str(uuid.uuid4()); object_row(OWNER+'/'+job+'/source','media-staging')
        sql("SELECT queue_media_upload('"+job+"','"+OWNER+"','video','Cleanup fixture','private');")
        sql('SELECT count(*) FROM claim_media_uploads(1);')
        path=OWNER+'/videos/'+job+'/stream.mp4';object_row(path,'user-videos')
        sql("UPDATE media_upload_jobs SET status='error',finished_at=now()-interval '20 minutes' WHERE id='"+job+"';")
        self.assertEqual(sql("SELECT count(*) FROM media_upload_cleanup_candidates() WHERE name='"+path+"';"),'1')
        # Old audit findings are never automatically adopted for rollback.
        sql("UPDATE media_upload_jobs SET integrity_version=0 WHERE id='"+job+"';")
        self.assertEqual(sql("SELECT count(*) FROM media_upload_cleanup_candidates() WHERE name='"+path+"';"),'0')


def main():
    global CONTAINER, DATABASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--database', default='audit_test')
    args = parser.parse_args()
    CONTAINER, DATABASE = args.container, args.database
    if not CONTAINER.startswith('streamly-audit-db-') or not DATABASE.startswith('audit_'):
        raise SystemExit('Refusing to run: isolated audit container/database required')
    details = json.loads(subprocess.check_output(['docker','inspect',CONTAINER]))[0]
    if details['HostConfig']['NetworkMode'] != 'none' or details['HostConfig'].get('PortBindings') or details['HostConfig'].get('Binds'):
        raise SystemExit('Refusing to run: tests require no network, no ports and no bind mounts')
    if sql('SELECT count(*) FROM auth.users;') != '0':
        raise SystemExit('Refusing to run: schema-only empty test database required')
    unittest.main(argv=[__file__], verbosity=2)


if __name__ == '__main__': main()
