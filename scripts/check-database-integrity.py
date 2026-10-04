#!/usr/bin/env python3
"""Admin/SSH read-only inventory and filesystem comparison; never repairs data.

Run on the Docker host. The only database commands are a repeatable-read READ ONLY
snapshot and read-only FK checks. Output may contain private object names/paths;
save it outside public web storage, with mode 0600. No credentials are collected.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid


def query(container, sql):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres',
        '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql,
        text=True, capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError('Read-only inventory query failed: ' + result.stderr[-2000:])
    return result.stdout.strip()


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def inspect_snapshot(snapshot, base=None):
    findings = []
    references = set()
    catalog = {(row['bucket'], row['name']): row for row in snapshot['objects']}
    users = set(snapshot['users'])
    settings = snapshot.get('storage_settings') or {}

    def issue(category, **values):
        findings.append({'category': category, **values})

    def reference(bucket, path, kind, content_id, required=True):
        if not path:
            if required: issue('missing_reference', type=kind, id=content_id)
            return
        prefix = (settings.get('videos_base_path' if bucket == 'user-videos' else 'images_base_path') or '').strip('/')
        candidates = [path, prefix + '/' + path] if prefix else [path]
        matches = [key for key in catalog if key[0] == bucket and
            (key[1] in candidates or key[1].endswith('/' + path))]
        if not matches:
            issue('missing_storage_object', type=kind, id=content_id, bucket=bucket, path=path)
        references.update(matches)

    for row in snapshot['videos']:
        reference('user-videos', row['storage_path'], 'video_original', row['id'])
        # Legacy records deliberately play storage_path when there is no separate
        # converted path. Report that fallback for probing, not as a missing file.
        if row['status'] == 'ready' and not row['processed_storage_path']:
            issue('legacy_video_uses_original', id=row['id'])
        else:
            reference('user-videos', row['processed_storage_path'], 'video_mp4', row['id'], row['status'] == 'ready')
        reference('user-images', row['preview_path'], 'video_preview', row['id'], False)
    for row in snapshot['photos']:
        for field in ['storage_path', 'preview_path', 'thumbnail_path']:
            reference('user-images', row[field], 'photo_' + field, row['id'])
    for row in snapshot['file_metadata']:
        path = row['path'] + ('/.folder' if row['is_folder'] else '')
        if row['is_folder']:
            matches = [key for key in catalog if key[0] == 'user-files' and
                (key[1] in (path, row['path'] + '/.keep') or key[1].startswith(row['path'] + '/'))]
            if not matches: issue('empty_folder_without_marker', path=row['path'])
            references.update(key for key in matches if key[1].endswith(('/.folder', '/.keep')))
        else:
            if ('user-files', path) not in catalog: issue('file_metadata_without_object', path=path)
            references.add(('user-files', path))
    for row in snapshot['jobs']:
        for name in ['source', 'preview']:
            references.add(('media-staging', row['owner'] + '/' + row['id'] + '/' + name))
        if row['status'] in ('processing', 'cancelling'):
            started = row.get('started_at')
            if not started or (datetime.now(timezone.utc) - datetime.fromisoformat(started)).total_seconds() > 10800:
                issue('stuck_media_job', id=row['id'], status=row['status'])
    for row in snapshot['previews']:
        references.add(('file-previews', row['preview_path']))
        source = next((obj for obj in snapshot['objects'] if obj['id'] == row['source_id']), None)
        if source and source['name'] != row['path']: issue('preview_source_moved', id=row['id'])
        if source and source.get('preview_version') and source['preview_version'] != row['source_version']:
            issue('preview_source_outdated', id=row['id'])
        if row['status'] == 'ready' and ('file-previews', row['preview_path']) not in catalog:
            issue('ready_preview_missing', id=row['id'])
        if row['status'] == 'generating' and row['started_at'] and (datetime.now(timezone.utc) - datetime.fromisoformat(row['started_at'])).total_seconds() > 300:
            issue('stuck_preview_job', id=row['id'])
    for key in catalog:
        if key not in references: issue('unreferenced_storage_object', bucket=key[0], path=key[1])
        if key[0] in ('user-videos', 'user-images', 'user-files', 'media-staging') and not any(part in users for part in key[1].split('/')):
            issue('storage_owner_missing', bucket=key[0], path=key[1])

    if base:
        base = Path(base).resolve(strict=True)
        expected = set()
        for row in snapshot['objects']:
            candidate = base / row['bucket'] / row['name']
            if row['version']: candidate = candidate / row['version']
            if not candidate.resolve().is_relative_to(base):
                issue('unsafe_storage_path', id=row['id']); continue
            relative = str(candidate.relative_to(base)); expected.add(relative)
            if not candidate.is_file(): issue('catalog_without_physical_file', id=row['id'], path=relative)
            elif row['size'] is not None and candidate.stat().st_size != int(row['size']):
                issue('physical_size_mismatch', id=row['id'], path=relative)
        for path in base.rglob('*'):
            if path.is_symlink(): issue('storage_symlink', path=str(path.relative_to(base))); continue
            if not path.is_file(): continue
            relative = str(path.relative_to(base))
            if relative in expected: continue
            # TUS receipts are metadata, not media payloads. Do not call them orphan content.
            receipt = False
            if path.suffix == '.json' and path.stat().st_size < 16384:
                try:
                    uuid.UUID(path.stem)
                    info = json.loads(path.read_text())
                    receipt = info.get('id') == base.name + '/' + str(path.with_suffix('').relative_to(base))
                except (ValueError, OSError, AttributeError): pass
            if receipt:
                issue('upload_receipt', path=relative, payload_exists=path.with_suffix('').is_file())
            else: issue('physical_file_without_catalog', path=relative, bytes=path.stat().st_size)
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', default='supabase-db')
    parser.add_argument('--storage-base', help='Configured GLOBAL_S3_BUCKET/TENANT_ID directory on the Docker host')
    parser.add_argument('--output', required=True, help='Private JSON report; never use the public storage tree')
    args = parser.parse_args()
    sql = Path(__file__).with_name('database-audit-inventory.sql').read_text()
    snapshot = json.loads(query(args.container, sql))
    violations = []
    for fk in snapshot['foreign_keys'] or []:
        child = identifier(fk['schema']) + '.' + identifier(fk['table_name'])
        parent = identifier(fk['parent_schema']) + '.' + identifier(fk['parent_table'])
        nonnull = ' AND '.join('c.' + identifier(col) + ' IS NOT NULL' for col in fk['columns'])
        join = ' AND '.join('p.' + identifier(p) + '=c.' + identifier(c) for c, p in zip(fk['columns'], fk['parent_columns']))
        count = int(query(args.container, 'BEGIN READ ONLY; SET LOCAL statement_timeout=\'30s\'; SELECT count(*) FROM ' + child +
            ' c WHERE ' + nonnull + ' AND NOT EXISTS(SELECT 1 FROM ' + parent + ' p WHERE ' + join + '); COMMIT;'))
        if count: violations.append({'constraint': fk['name'], 'rows': count})
    snapshot['foreign_key_violations'] = violations
    snapshot['findings'] = inspect_snapshot(snapshot, args.storage_base)
    snapshot['captured_at'] = datetime.now(timezone.utc).isoformat()
    snapshot['mode'] = 'read-only; concurrent operations can change storage after the database snapshot'
    output = Path(args.output)
    if args.storage_base and output.resolve().is_relative_to(Path(args.storage_base).resolve()):
        raise ValueError('Audit reports must be stored outside the publicly served storage tree')
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    os.chmod(output, 0o600)
    with os.fdopen(descriptor, 'w') as handle: json.dump(snapshot, handle, indent=2)
    counts = {}
    for finding in snapshot['findings']:
        counts[finding['category']] = counts.get(finding['category'], 0) + 1
    print(json.dumps({'engine': snapshot['engine'], 'tables': len(snapshot['tables']),
        'foreign_key_violations': violations, 'database_checks': snapshot['checks'], 'storage_findings': counts,
        'report': str(output)}, indent=2))


if __name__ == '__main__':
    main()
