"""Bounded single-conversion queue, private Storage cache, retryable cleanup."""
import concurrent.futures
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
from uuid import UUID
from urllib.parse import quote
import requests

URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
HEADERS = {'Authorization': 'Bearer ' + KEY, 'apikey': KEY}
LOG = logging.getLogger('file-previews')
logging.basicConfig(level=logging.INFO, format='%(message)s')
TIMEOUT = 120


def api(method, path, **kwargs):
    response = requests.request(method, URL + path, headers={**HEADERS, **kwargs.pop('headers', {})}, timeout=(10, 30), **kwargs)
    response.raise_for_status()
    return response.json() if response.content else None


def current(job):
    rows = api('GET', '/rest/v1/file_preview_jobs?id=eq.' + job['id'] + '&status=eq.generating')
    return bool(rows)


def remove_cache(path, bucket='file-previews'):
    if bucket not in ('file-previews', 'cache'):
        raise ValueError('Invalid preview cache bucket')
    api('DELETE', '/storage/v1/object/' + bucket, json={'prefixes': [path]})


def cache_location(job):
    bucket = job.get('cache_bucket', 'file-previews')
    identity = str(UUID(job['id']))
    if bucket == 'cache' and job.get('source_bucket') in ('user-files', 'users'):
        expected = 'previews/' + str(UUID(job['owner_id'])) + '/' + str(UUID(job['source_id'])) + '/' + identity + '.pdf'
    elif bucket == 'file-previews':
        expected = identity + '.pdf'
    else:
        raise ValueError('Invalid preview cache location')
    if job['preview_path'] != expected:
        raise ValueError('Invalid preview cache location')
    return bucket, expected


def remove_job_cache(job):
    # Keep the legacy helper call shape for existing jobs and their retry tests.
    if job.get('cache_bucket', 'file-previews') == 'file-previews':
        remove_cache(job['preview_path'])
    else:
        bucket, path = cache_location(job)
        remove_cache(path, bucket)


def source_current(job):
    source = api('POST', '/rest/v1/rpc/get_preview_source_by_id', json={'p_id': job['source_id']})
    return (source and source['id'] == job['source_id'] and source['version'] == job['source_version']
            and source['path'] == job['object_path'] and source['bucket'] == job.get('source_bucket', 'user-files'))


def recover_uploaded_preview(job):
    """An HTTP timeout is not evidence that the ready transaction rolled back.

    Retain an acknowledged ready cache. When the database cannot be reached,
    retain bytes for the existing cache reconciler instead of risking data loss.
    """
    try:
        rows = api('GET', '/rest/v1/file_preview_jobs?id=eq.' + job['id']) or []
        if rows and rows[0]['status'] == 'ready' and source_current(job):
            LOG.info(json.dumps({'operation': 'preview_publication_recovered', 'id': job['id']}))
            return True
        if rows and rows[0]['status'] == 'generating':
            # Serialize against a still-committing ready request. A plain GET
            # can see the old MVCC snapshot while that request holds the row.
            changed = api('PATCH', '/rest/v1/file_preview_jobs?id=eq.' + job['id'] + '&status=eq.generating',
                headers={'Prefer': 'return=representation'}, json={'status': 'failed',
                    'error': 'Preview could not be generated. You can still download the original file.',
                    'finished_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
            if not changed:
                rows = api('GET', '/rest/v1/file_preview_jobs?id=eq.' + job['id']) or []
                if rows and rows[0]['status'] == 'ready' and source_current(job):
                    return True
        remove_job_cache(job)
    except Exception:
        LOG.error(json.dumps({'operation': 'preview_cleanup_deferred', 'id': job['id']}))
    return False


def process(job):
    uploaded = False
    try:
        cache_bucket, cache_path = cache_location(job)
        with tempfile.TemporaryDirectory(prefix='preview-', dir='/work') as folder:
            root = Path(folder)
            root.chmod(0o755)
            source = root / ('source.' + job['extension'])
            maximum = (20 if job['extension'] in ('xlsx', 'xls') else 25) * 1048576
            if not source_current(job) or not current(job):
                return
            # Streaming, bounded download. The converter has read-only source access.
            bucket = job.get('source_bucket', 'user-files')
            if bucket not in ('user-files', 'users', 'messenger-attachments'):
                raise ValueError('Preview source unavailable.')
            with requests.get(URL + '/storage/v1/object/authenticated/' + bucket + '/' + quote(job['object_path'], safe='/'),
                              headers=HEADERS, stream=True, timeout=(10, 30)) as response:
                response.raise_for_status()
                total = 0
                with source.open('wb') as handle:
                    for chunk in response.iter_content(1048576):
                        total += len(chunk)
                        if total > maximum:
                            raise ValueError('This file exceeds the Office preview size limit.')
                        handle.write(chunk)
            source.chmod(0o444)
            original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            output = root / 'output'; output.mkdir(); os.chown(output, 10002, 10002)
            profile = root / 'profile'; profile.mkdir(); os.chown(profile, 10002, 10002)
            with (root / 'decoder.log').open('w+') as log:
                child = subprocess.Popen(['python', '/app/convert.py', str(source), job['extension'], str(output), str(profile)],
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True, user=10002, group=10002, extra_groups=[],
                    env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(profile), 'TMPDIR': str(profile), 'PYTHONUNBUFFERED': '1'})
                started = time.monotonic()
                try:
                    while child.poll() is None:
                        if time.monotonic() - started > TIMEOUT:
                            raise ValueError('Preview generation exceeded the time limit. You can still download the original file.')
                        if not current(job):
                            return
                        time.sleep(1)
                finally:
                    # Terminate the entire decoder tree on failure, source deletion,
                    # timeout, or completion (LO must not survive the job).
                    try: os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    child.wait()
                    log.seek(0); diagnostic = log.read()[-24000:]
                    LOG.info(json.dumps({'operation': 'preview_conversion', 'id': job['id'], 'exit': child.returncode, 'diagnostic': diagnostic}))
                if child.returncode:
                    message = 'Preview could not be generated. You can still download the original file.'
                    for line in diagnostic.splitlines():
                        try: message = json.loads(line).get('user_error', message)
                        except (ValueError, AttributeError): pass
                    raise ValueError(message)
            if hashlib.sha256(source.read_bytes()).hexdigest() != original_hash:
                raise ValueError('Preview could not be generated.')
            if not current(job) or not source_current(job):
                return
            pdf = output / 'source.pdf'
            if not pdf.is_file() or not 0 < pdf.stat().st_size <= 50 * 1048576:
                raise ValueError('The generated preview exceeds the preview size limit.')
            uploaded = True  # Ambiguous upload responses still require cleanup.
            with pdf.open('rb') as handle:
                api('POST', '/storage/v1/object/' + cache_bucket + '/' + cache_path, data=handle,
                    headers={'Content-Type': 'application/pdf', 'x-upsert': 'false'})
            if not source_current(job):
                remove_job_cache(job); uploaded = False
                return
            changed = api('PATCH', '/rest/v1/file_preview_jobs?id=eq.' + job['id'] + '&status=eq.generating',
                headers={'Prefer': 'return=representation'}, json={'status': 'ready', 'error': None,
                    'finished_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
            if not changed:
                remove_job_cache(job); uploaded = False
                return
            uploaded = False
            LOG.info(json.dumps({'operation': 'file_preview_ready', 'id': job['id'], 'bytes': pdf.stat().st_size}))
    except Exception as cause:
        if uploaded:
            if recover_uploaded_preview(job):
                return
        # Detailed diagnostics stay on the server; deliberate ValueErrors are safe.
        LOG.error(json.dumps({'operation': 'file_preview_failed', 'id': job['id'], 'type': type(cause).__name__, 'detail': str(cause)}), exc_info=True)
        message = str(cause) if isinstance(cause, ValueError) else 'Preview could not be generated. You can still download the original file.'
        api('PATCH', '/rest/v1/file_preview_jobs?id=eq.' + job['id'] + '&status=eq.generating',
            json={'status': 'failed', 'error': message, 'finished_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})


def cleanup():
    api('POST', '/rest/v1/rpc/reconcile_file_preview_cache', json={})
    for item in api('POST', '/rest/v1/rpc/file_preview_cleanup_candidates', json={}) or []:
        try:
            remove_cache(item['path'], item['cache_bucket'])
            api('DELETE', '/rest/v1/file_preview_cleanup?path=eq.' + quote(item['path'], safe=''))
        except Exception as cause:
            LOG.error(json.dumps({'operation': 'preview_cache_cleanup', 'type': type(cause).__name__}))
    # Reservations expire after 24 hours. This queue contains only paths whose
    # attachment record was removed, never arbitrary existing library content.
    api('POST', '/rest/v1/rpc/messenger_reconcile_uploads', json={})
    for item in api('GET', '/rest/v1/messenger_storage_cleanup?order=created_at&limit=50') or []:
        try:
            api('DELETE', '/storage/v1/object/messenger-attachments', json={'prefixes': [item['object_path']]})
            api('DELETE', '/rest/v1/messenger_storage_cleanup?object_path=eq.' + quote(item['object_path'], safe=''))
        except Exception as cause:
            LOG.error(json.dumps({'operation': 'messenger_attachment_cleanup', 'type': type(cause).__name__}))
    # Expire abandoned calls/signaling even when every browser has disconnected.
    # Interactive signaling reconciles independently and never waits for this worker.
    api('POST', '/rest/v1/rpc/messenger_reconcile_calls', json={})


def main():
    if not URL or not KEY:
        raise RuntimeError('Preview worker credentials are not configured')
    subprocess.run(['libreoffice', '--version'], check=True, stdout=subprocess.DEVNULL,
        env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp', 'XDG_CACHE_HOME': '/tmp'})
    # Container scratch is private derived data, never mounted original storage.
    for path in Path('/work').glob('preview-*'):
        if path.is_symlink(): path.unlink()
        elif path.is_dir(): shutil.rmtree(path)
    active = None
    active_job = None
    last_cleanup = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        while True:
            try:
                control = api('POST', '/rest/v1/rpc/library_worker_control', json={})
                if not isinstance(control, dict) or 'pause_preview_claims' not in control:
                    raise RuntimeError('Preview worker control unavailable')
                if active is None or active.done():
                    if active: active.result()
                    jobs = [] if control['pause_preview_claims'] else api('POST', '/rest/v1/rpc/claim_file_preview', json={})
                    active_job = jobs[0] if jobs else None
                    active = pool.submit(process, jobs[0]) if jobs else None
                if time.monotonic() - last_cleanup > 10:
                    cleanup(); last_cleanup = time.monotonic()
                # Written after synchronous cleanup and based on the actual future,
                # not a job status that may commit before its last Storage request.
                busy = bool(active and not active.done())
                state = {'active_jobs': int(busy), 'library_active': bool(busy and active_job and
                    active_job.get('source_bucket', 'user-files') != 'messenger-attachments'),
                    'draining': bool(control['pause_preview_claims'] or control['pause_media_claims'] or control['pause_library_writes']),
                    'observed_at': time.time()}
                temporary = Path('/tmp/preview-worker-state.next')
                temporary.write_text(json.dumps(state)); temporary.replace('/tmp/preview-worker-state.json')
                Path('/tmp/preview-heartbeat').touch()
            except Exception as cause:
                LOG.error(json.dumps({'operation': 'preview_worker_poll', 'type': type(cause).__name__}))
                active = None if active and active.done() else active
            time.sleep(2)


if __name__ == '__main__': main()
