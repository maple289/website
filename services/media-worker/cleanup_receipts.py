"""Remove TUS receipts only for confirmed, completed video deletions.

Storage deletes payloads/catalog rows through its API, but its local TUS store
can leave an upload-receipt JSON after the payload is gone. Never remove payloads.
"""
import json
import logging
import os
import pathlib
import time
import uuid


def clean_receipts(base, records):
    base = pathlib.Path(base).resolve()
    removed = 0
    for row in records:
        owner = str(uuid.UUID(row['owner']))
        for job in set(row['ids']):
            job = str(uuid.UUID(job))
            for kind in ('source', 'preview'):
                directory = base / 'media-staging' / owner / job / kind
                if not directory.resolve().is_relative_to(base):
                    continue
                for receipt in directory.glob('*.json'):
                    if receipt.is_symlink() or not receipt.resolve().is_relative_to(base):
                        continue
                    payload = receipt.with_suffix('')
                    if payload.exists() or payload.is_symlink():
                        continue
                    try:
                        uuid.UUID(payload.name)
                        data = json.loads(receipt.read_text())
                        expected = base.name + '/' + str(payload.relative_to(base))
                        if data.get('id') != expected:
                            continue
                        # Check again immediately before removing metadata.
                        if not payload.exists():
                            receipt.unlink()
                            removed += 1
                    except (ValueError, OSError):
                        continue
    return removed


def main():
    import requests
    bucket, tenant = os.environ['GLOBAL_S3_BUCKET'], os.environ['TENANT_ID']
    if any('/' in part or part in ('', '.', '..') for part in (bucket, tenant)):
        raise ValueError('Invalid local storage configuration')
    base = pathlib.Path('/storage') / bucket / tenant
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    url = os.environ['SUPABASE_URL'].rstrip('/')
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    while True:
        try:
            offset, count = 0, 0
            while True:
                response = requests.get(url + '/rest/v1/video_deletions',
                    params={'select': 'id,owner_id,staging_ids', 'completed_at': 'not.is.null',
                            'order': 'requested_at,id', 'limit': 1000, 'offset': offset},
                    headers={'apikey': key, 'Authorization': 'Bearer ' + key}, timeout=(10, 60))
                response.raise_for_status()
                rows = response.json()
                count += clean_receipts(base, [{'owner': row['owner_id'],
                    'ids': [row['id'], *row['staging_ids']]} for row in rows])
                if len(rows) < 1000:
                    break
                offset += len(rows)
            if count:
                logging.info(json.dumps({'operation': 'deleted_upload_receipt_cleanup', 'removed': count}))
        except Exception as error:
            # HTTP exception strings can include endpoints. Never emit secrets or paths.
            logging.error(json.dumps({'operation': 'deleted_upload_receipt_cleanup',
                                      'result': 'error', 'type': type(error).__name__}))
        pathlib.Path('/tmp/receipt-heartbeat').touch()
        time.sleep(60)


if __name__ == '__main__':
    main()
