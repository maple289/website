"""Run inside the deployed preview worker with disposable fixture files.

Credentials come from the server environment, never from test source/output.
Creates two isolated users and only deletes objects/accounts created by this run.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import time
from urllib.parse import quote
import requests

URL = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
ANON = os.environ['TEST_ANON_KEY']
ADMIN = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY}
PUBLIC = {'apikey': ANON, 'Authorization': 'Bearer ' + ANON}
FIXTURES = Path(sys.argv[1])
users, paths, checks = [], [], []
run = 'preview-' + secrets.token_hex(5)


def request(method, path, headers=ADMIN, **kwargs):
    response = requests.request(method, URL + path, headers=headers, timeout=30, **kwargs)
    if response.status_code >= 400:
        # Supabase errors may contain email addresses but never print auth tokens.
        raise RuntimeError(f'{method} {path.split("?")[0]} HTTP {response.status_code}: {response.text[:300]}')
    return response.json() if 'json' in response.headers.get('content-type', '') else response.content


def pass_check(label):
    checks.append(label); print('PASS ' + label, flush=True)


def create_user():
    email = run + '-' + str(len(users)) + '@example.invalid'
    password = secrets.token_urlsafe(24) + 'aA2!'
    user = request('POST', '/auth/v1/admin/users', json={'email': email, 'password': password, 'email_confirm': True})
    users.append(user['id'])
    token = request('POST', '/auth/v1/token?grant_type=password', headers=PUBLIC, json={'email': email, 'password': password})['access_token']
    return {'apikey': ANON, 'Authorization': 'Bearer ' + token}


def upload(name, data=None):
    data = data if data is not None else (FIXTURES / name).read_bytes()
    path = users[0] + '/' + run + '/' + name
    request('POST', '/storage/v1/object/user-files/' + quote(path, safe='/'), headers={**ADMIN, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true'}, data=data)
    if path not in paths: paths.append(path)
    request('POST', '/rest/v1/user_file_metadata?on_conflict=owner_id,object_path', headers={**ADMIN, 'Prefer': 'resolution=merge-duplicates'},
        json={'owner_id': users[0], 'object_path': path, 'file_size': len(data), 'mime_type': 'application/octet-stream'})
    return path


def metadata(path):
    return request('GET', '/rest/v1/user_file_metadata?object_path=eq.' + quote(path, safe='') + '&select=public_id')[0]


def preview(path=None, public_id=None, headers=None, content=False):
    parameter = 'id=' + public_id if public_id else 'path=' + quote(path, safe='')
    response = requests.get(URL + '/functions/v1/file-preview?' + parameter + ('&content=1' if content else ''), headers=headers or owner, timeout=30)
    return response


def ready(path, headers=None, public_id=None):
    for _ in range(90):
        response = preview(path, public_id, headers)
        value = response.json()
        if value.get('status') == 'available': return value
        assert value.get('status') == 'generating', (response.status_code, value)
        time.sleep(2)
    raise AssertionError('Office preview did not complete')


def jobs(path):
    return request('GET', '/rest/v1/file_preview_jobs?object_path=eq.' + quote(path, safe=''))


def cache_absent(cache_path):
    for _ in range(20):
        response = requests.get(URL + '/storage/v1/object/authenticated/file-previews/' + cache_path, headers=ADMIN, timeout=10)
        if response.status_code >= 400: return
        time.sleep(1)
    raise AssertionError('Cached preview was not cleaned up')


try:
    owner = create_user(); other = create_user()
    pass_check('isolated owner and unrelated user created')
    originals = {}
    for name in ['sample.pdf', 'sample.jpg', 'sample.jpeg', 'sample.png', 'sample.gif', 'sample.webp', 'sample.txt', 'sample.json', 'sample.xml', 'sample.csv', 'sample.docx', 'sample.xlsx', 'sample.pptx']:
        path = upload(name); originals[path] = hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest()
        identifier = metadata(path)['public_id']
        for denied_headers, public_id, denied_path in [(PUBLIC, None, path), (other, None, path), (PUBLIC, identifier, None), (other, identifier, None)]:
            denied = preview(denied_path, public_id, denied_headers, True)
            assert denied.status_code == 404 and users[0] not in denied.text
        value = ready(path)
        content = preview(path, headers=owner, content=True)
        assert content.status_code == 200
        if name.endswith(('.docx', '.xlsx', '.pptx')):
            assert value['kind'] == 'pdf' and content.content.startswith(b'%PDF-')
            job = jobs(path)[0]
            assert job['status'] == 'ready'
            from pypdf import PdfReader
            import io
            assert len(PdfReader(io.BytesIO(content.content)).pages) >= 1
            again = ready(path)
            assert jobs(path)[0]['id'] == job['id'] and jobs(path)[0]['finished_at'] == job['finished_at']
            for headers in (PUBLIC, owner, other):
                denied = requests.get(URL + '/storage/v1/object/authenticated/file-previews/' + job['preview_path'], headers=headers, timeout=10)
                assert denied.status_code >= 400
            pass_check(name + ' converted to PDF, cached, and direct cache access denied')
        else:
            assert hashlib.sha256(content.content).hexdigest() == originals[path]
            pass_check(name + ' browser-friendly preview available')
        original = request('GET', '/storage/v1/object/authenticated/user-files/' + quote(path, safe='/'))
        assert hashlib.sha256(original).hexdigest() == originals[path]
        pass_check(name + ' original unchanged; guest and unrelated user denied')

    # Folder inheritance and revocation use the exact existing sharing rules.
    folder = users[0] + '/' + run
    request('POST', '/rest/v1/user_file_metadata', json={'owner_id': users[0], 'object_path': folder, 'is_folder': True})
    request('POST', '/rest/v1/user_file_shares', json={'owner_id': users[0], 'object_path': folder, 'recipient_id': users[1]})
    path = users[0] + '/' + run + '/sample.docx'; identifier = metadata(path)['public_id']
    assert ready(path, other)['kind'] == 'pdf'
    assert preview(path, headers=PUBLIC, content=True).status_code == 404
    pass_check('shared-folder recipient inherits preview access; guests denied')
    request('DELETE', '/rest/v1/user_file_shares?object_path=eq.' + quote(folder, safe=''))
    assert preview(path, headers=other, content=True).status_code == 404
    pass_check('revoked shared user cannot request cached preview')
    request('POST', '/rest/v1/user_file_shares', json={'owner_id': users[0], 'object_path': folder, 'recipient_id': None})
    assert ready(None, PUBLIC, identifier)['kind'] == 'pdf'
    public_content = preview(public_id=identifier, headers=PUBLIC, content=True)
    assert public_content.status_code == 200 and public_content.content.startswith(b'%PDF-')
    public_status = preview(public_id=identifier, headers=PUBLIC).text
    assert users[0] not in public_status and 'object_path' not in public_status and 'preview_path' not in public_status
    pass_check('Everyone folder allows guest preview without exposing storage paths')
    request('DELETE', '/rest/v1/user_file_shares?object_path=eq.' + quote(folder, safe=''))
    assert preview(public_id=identifier, headers=PUBLIC, content=True).status_code == 404
    pass_check('revoking Everyone blocks cached public preview immediately')

    # Content replacement and physical timestamp changes invalidate cache.
    old_job = jobs(path)[0]
    upload('sample.docx', (FIXTURES / 'sample-replaced.docx').read_bytes())
    ready(path); new_job = jobs(path)[0]
    assert new_job['id'] != old_job['id']
    cache_absent(old_job['preview_path'])
    pass_check('source replacement regenerates preview and removes old cache')

    bad_path = upload('corrupt.docx', b'not an Office document')
    for _ in range(40):
        bad = preview(bad_path).json()
        if bad['status'] == 'failed': break
        assert bad['status'] == 'generating'; time.sleep(1)
    assert bad['status'] == 'failed' and users[0] not in bad.get('message', '')
    bad_job = jobs(bad_path)[0]; cache_absent(bad_job['preview_path'])
    assert request('GET', '/storage/v1/object/authenticated/user-files/' + quote(bad_path, safe='/')) == b'not an Office document'
    pass_check('corrupt Office fails safely, retains original, leaves no partial PDF')
    unsupported = upload('sample.bin', b'unsupported')
    assert preview(unsupported).json()['status'] == 'unsupported'
    assert not jobs(unsupported)
    pass_check('unsupported format does not enqueue a conversion')
    after_failure = upload('after-failure.docx', (FIXTURES / 'sample.docx').read_bytes()); ready(after_failure)
    pass_check('one failed document does not block subsequent conversions')
    cache = jobs(after_failure)[0]['preview_path']
    request('DELETE', '/storage/v1/object/user-files', json={'prefixes': [after_failure]})
    assert not jobs(after_failure)
    cache_absent(cache)
    assert preview(after_failure, content=True).status_code == 404
    pass_check('source deletion removes job and cached PDF; preview remains unavailable')
    # Limits apply before any conversion, independently of client MIME/filename.
    large_path = upload('oversized.xlsx', b'0' * (20 * 1048576 + 1))
    large = preview(large_path).json()
    assert large['status'] == 'failed' and '20 MB' in large['message'] and not jobs(large_path)
    pass_check('oversized workbook rejected for preview without conversion or source deletion')
    # Concurrent opens must enqueue one conversion, not one job per request.
    import concurrent.futures
    concurrent_path = upload('concurrent.docx', (FIXTURES / 'sample.docx').read_bytes())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda _: preview(concurrent_path), range(12)))
    assert all(response.status_code in (200, 202) for response in responses)
    ready(concurrent_path); assert len(jobs(concurrent_path)) == 1
    pass_check('12 concurrent preview requests reuse one job')
    # The tables and enqueue RPC must be inaccessible to browser roles.
    for endpoint in ['/rest/v1/file_preview_jobs', '/rest/v1/file_preview_cleanup']:
        response = requests.get(URL + endpoint, headers=owner, timeout=10)
        assert response.status_code >= 400 or response.json() == []
    response = requests.post(URL + '/rest/v1/rpc/queue_file_preview', headers=owner,
        json={'p_source_id': new_job['source_id'], 'p_version': new_job['source_version'], 'p_extension': 'docx'}, timeout=10)
    assert response.status_code >= 400
    pass_check('browser cannot inspect or mutate server-only preview jobs')
    # Account cascade removes derived caches even though existing account deletion
    # deliberately retains original uploaded Storage objects.
    remaining_cache = [job['preview_path'] for path in paths for job in jobs(path)]
    request('DELETE', '/auth/v1/admin/users/' + users[0]); removed_user = users.pop(0)
    for cached in remaining_cache: cache_absent(cached)
    pass_check('account removal cleans preview jobs and caches')
    print(json.dumps({'result': 'passed', 'checks': len(checks)}), flush=True)
finally:
    # Scope cleanup strictly to generated users and tracked source keys.
    if paths:
        request('DELETE', '/storage/v1/object/user-files', json={'prefixes': paths})
    for uid in users:
        request('DELETE', '/rest/v1/user_file_metadata?owner_id=eq.' + uid)
        request('DELETE', '/auth/v1/admin/users/' + uid)
    print('Disposable preview-test accounts and sources removed.', flush=True)
