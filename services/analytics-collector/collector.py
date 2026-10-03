"""Read-only periodic inventory; dashboard requests never walk the filesystem."""
import collections
import json
import logging
import os
import pathlib
import shutil
import stat
import time
import requests

URL = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
HEADERS = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY}
INTERVAL = max(300, int(os.environ.get('ANALYTICS_STORAGE_INTERVAL', '600')))
CATEGORIES = ['Videos', 'Photos', 'Files', 'Preview cache', 'Temporary / processing', 'Other application data']


def rpc(name, body):
    response = requests.post(URL + '/rest/v1/rpc/' + name, headers=HEADERS, json=body, timeout=(10, 90))
    response.raise_for_status()
    return response.json() if response.content else None


def collect(storage_mount=pathlib.Path('/storage'), scratch=pathlib.Path('/scratch'), heartbeat=pathlib.Path('/tmp/analytics-heartbeat')):
    inventory, after = {}, None
    while True:
        rows = rpc('analytics_inventory', {'p_after': after})
        for row in rows:
            inventory[(row['bucket_id'], row['name'])] = row
        if len(rows) < 1000:
            break
        after = rows[-1]['id']
    categories = collections.Counter({name: 0 for name in CATEGORIES})
    users, errors, disks = collections.Counter(), [], []
    bucket, tenant = os.environ['GLOBAL_S3_BUCKET'], os.environ['TENANT_ID']
    if any('/' in part or part in ('', '.', '..') for part in (bucket, tenant)):
        raise ValueError('Invalid storage root')
    storage = storage_mount / bucket / tenant
    seen_disks, seen_files = set(), set()
    for label, root in [('Content storage', storage), ('Conversion scratch', scratch)]:
        try:
            device = root.stat().st_dev
            if device not in seen_disks:
                size = shutil.disk_usage(root)
                disks.append({'label': label, 'capacity': size.total, 'used': size.used, 'available': size.free,
                              'usage_percent': round(size.used / size.total * 100, 2) if size.total else 0})
                seen_disks.add(device)
        except OSError:
            errors.append(label + ' capacity unavailable')
            continue

        def inaccessible(error):
            # Normal uploads/deletions may remove an entry during the periodic scan.
            if isinstance(error, FileNotFoundError):
                return
            if label + ' contains unreadable entries' not in errors:
                errors.append(label + ' contains unreadable entries')

        for base, dirs, files in os.walk(root, followlinks=False, onerror=inaccessible):
            heartbeat.touch()
            dirs[:] = [d for d in dirs if not (pathlib.Path(base) / d).is_symlink()]
            for name in files:
                path = pathlib.Path(base) / name
                try:
                    file_stat = path.lstat()
                    if not stat.S_ISREG(file_stat.st_mode):
                        continue
                    identity = (file_stat.st_dev, file_stat.st_ino)
                    if identity in seen_files:
                        continue
                    seen_files.add(identity)
                    category, owner = 'Temporary / processing', None
                    if root == storage:
                        parts = path.relative_to(root).parts
                        row = inventory.get((parts[0], '/'.join(parts[1:-1]))) if len(parts) >= 3 else None
                        if row:
                            category, owner = row['category'], row['owner_id']
                        else:
                            # Retained/unindexed payloads still occupy disk. Do not
                            # assign their bytes to a deleted account/content record.
                            category = {'user-videos': 'Videos', 'user-images': 'Photos', 'user-files': 'Files',
                                        'file-previews': 'Preview cache', 'media-staging': 'Temporary / processing'}.get(parts[0], 'Other application data')
                    categories[category] += file_stat.st_size
                    if owner and category in ('Videos', 'Photos', 'Files'):
                        users[owner] += file_stat.st_size
                except OSError as error:
                    inaccessible(error)
    # Database allocation is provided by PostgreSQL, not a filesystem traversal.
    database_bytes = rpc('analytics_database_bytes', {})
    categories['Other application data'] += database_bytes
    rpc('analytics_store_snapshot', {'p_data': {
        'disks': disks, 'categories': [{'label': k, 'value': v} for k, v in categories.items()],
        'users': [{'id': k, 'value': v} for k, v in users.items()], 'errors': errors,
        'interval_seconds': INTERVAL, 'database_bytes': database_bytes,
        'measurement': 'Stored payload bytes plus database allocation; disk capacity includes the operating system and other filesystem data.'}})
    logging.info(json.dumps({'operation': 'analytics_storage_collection', 'result': 'completed', 'incomplete_locations': len(errors)}))


def main():
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    while True:
        pathlib.Path('/tmp/analytics-heartbeat').touch()
        try:
            collect()
        except Exception as error:
            # Exception text may include request URLs; never log headers or keys.
            response = getattr(error, 'response', None)
            logging.error(json.dumps({'operation': 'analytics_storage_collection', 'result': 'failed', 'type': type(error).__name__,
                                      'status': response.status_code if response is not None else None}))
        for _ in range(INTERVAL // 10):
            pathlib.Path('/tmp/analytics-heartbeat').touch()
            time.sleep(10)


if __name__ == '__main__':
    main()
