#!/usr/bin/env python3
"""Phase-0 reports only: never copies, moves, deletes, alters SQL or calls Storage.

Input is storage-layout-inventory.sql JSON (or the older database audit snapshot).
--storage-base is the actual GLOBAL_S3_BUCKET/TENANT_ID directory, not a guess.
Reports contain private object keys; keep them outside public storage and Git.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import uuid


ACTIVE = {'queued', 'processing', 'generating', 'uploading', 'retrying', 'cancel_requested'}


def identifier(value):
    try:
        return str(uuid.UUID(str(value))) == str(value).lower()
    except (ValueError, TypeError, AttributeError):
        return False


def key(value):
    return isinstance(value, str) and bool(value) and all(
        part not in ('', '.', '..') and '\\' not in part and not any(ord(c) < 32 or ord(c) == 127 for c in part)
        for part in value.split('/'))


def local_file(base, relative):
    if not key(relative):
        raise ValueError('Unsafe catalog path')
    candidate = base
    for part in relative.split('/'):
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError('Symlink is not a migration source')
    if not candidate.resolve().is_relative_to(base):
        raise ValueError('Catalog path escapes storage')
    return candidate


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def probe_video(path):
    try:
        result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file',
            '-format_whitelist', 'mov', '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_type,codec_name,duration:format=duration,format_name',
            '-of', 'json', str(path)], capture_output=True, text=True, timeout=45)
        if result.returncode:
            return {'valid': False, 'reason': 'ffprobe rejected final media'}
        data = json.loads(result.stdout)
        stream = next((s for s in data.get('streams', []) if s.get('codec_type') == 'video'), None)
        duration = float(data.get('format', {}).get('duration') or (stream or {}).get('duration') or 0)
        mp4 = 'mp4' in data.get('format', {}).get('format_name', '').split(',')
        return {'valid': bool(stream and mp4 and math.isfinite(duration) and duration > 0),
            'duration': duration if math.isfinite(duration) else None, 'codec': (stream or {}).get('codec_name')}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {'valid': False, 'reason': 'ffprobe unavailable, timed out or returned invalid metadata'}


def owner(row):
    return row.get('owner_id') or row.get('owner')


def make_manifest(snapshot, base=None, hashes=False, probes=False):
    """Exact-key joins only. Object paths never establish ownership by themselves."""
    base = Path(base).resolve(strict=True) if base else None
    users = set(snapshot.get('users') or [])
    settings = snapshot.get('storage_settings') or {}
    objects = snapshot.get('objects') or []
    catalog = defaultdict(list)
    for obj in objects:
        catalog[obj['bucket'], obj['name']].append(obj)
    references = defaultdict(list)
    missing = []

    def add(bucket, path, row, kind, role, target):
        if not path:
            return
        prefix = (settings.get('videos_base_path' if bucket == 'user-videos' else 'images_base_path') or '').strip('/') if bucket in ('user-videos', 'user-images') else ''
        candidates = {path, prefix + '/' + path} if prefix else {path}
        matches = [o for name in candidates for o in catalog[bucket, name]]
        ref = {'owner': owner(row), 'media_id': row.get('id') or row.get('source_id') or '',
            'kind': kind, 'role': role, 'target': target, 'db_path': path,
            'db_table': {'video': 'public.videos', 'photo': 'public.photos', 'file': 'public.user_file_metadata'}[kind],
            'db_record_path': (row.get('object_path') or row.get('path')) if kind == 'file' else None}
        if len(matches) != 1:
            missing.append({**ref, 'bucket': bucket, 'reason': 'missing or ambiguous exact catalog key'})
            return
        obj = matches[0]
        if kind == 'file' and not ref['media_id']:
            ref['media_id'] = obj['id']
        stripped = obj['name'][len(prefix) + 1:] if prefix and obj['name'].startswith(prefix + '/') else obj['name']
        valid = identifier(owner(row)) and owner(row) in users and key(path) and key(stripped) and stripped.startswith(owner(row) + '/')
        if obj.get('owner') and obj['owner'] != owner(row):
            valid = False
        if kind == 'file' and role != 'folder_marker' and row.get('source_id') and row['source_id'] != obj['id']:
            valid = False
        parts = stripped.split('/')
        if kind in ('video', 'photo') and len(parts) > 2 and parts[1] in ('videos', 'photos', 'video-previews'):
            try:
                folder_id = str(uuid.UUID(parts[2]))  # Legacy keys can contain 32 hex characters.
            except ValueError:
                folder_id = None
            if folder_id and folder_id != row.get('id'):
                valid = False
        ref['owner_verified'] = bool(valid)
        references[bucket, obj['name']].append(ref)

    for row in snapshot.get('videos') or []:
        root = f"users/{owner(row)}/videos/{row['id']}"
        final = row.get('processed_storage_path') or row.get('storage_path')
        source = row.get('storage_path')
        ready_mp4 = (row.get('processing_status') or row.get('status')) == 'ready' and isinstance(final, str) and final.lower().endswith('.mp4')
        add('user-videos', final, row, 'video', 'active_video', root + '/video.mp4' if ready_mp4 else '')
        if source and source != final:
            add('user-videos', source, row, 'video', 'original_requires_review', '')
        preview = row.get('preview_path')
        if preview:
            add('user-images', preview, row, 'video', 'thumbnail', root + '/thumbnail' + PurePosixPath(preview).suffix)
    for row in snapshot.get('photos') or []:
        root = f"users/{owner(row)}/photos/{row['id']}"
        for field, name in [('storage_path', 'photo'), ('preview_path', 'preview'), ('thumbnail_path', 'thumbnail')]:
            path = row.get(field)
            if path:
                add('user-images', path, row, 'photo', field, root + '/' + name + PurePosixPath(path).suffix)
    for row in snapshot.get('file_metadata') or []:
        path = row.get('object_path') or row.get('path') or ''
        account = owner(row) or ''
        if not path.startswith(account + '/') or not identifier(account):
            missing.append({'kind': 'file', 'owner': account, 'db_path': path, 'reason': 'metadata owner/path mismatch'})
            continue
        paths = [path] if not row.get('is_folder') else [path + '/.folder', path + '/.keep']
        for item in paths:
            if row.get('is_folder') and not catalog['user-files', item]:
                continue  # A metadata-only directory is not a missing payload.
            add('user-files', item, row, 'file', 'folder_marker' if row.get('is_folder') else 'file',
                f'users/{account}/files/' + item[len(account) + 1:])

    rows, physical_index = [], {}
    for obj in objects:
        bucket, name = obj['bucket'], obj['name']
        refs = references[bucket, name]
        targets = {r['target'] for r in refs if r['target']}
        identities = {(r['owner'], r['media_id']) for r in refs}
        media_valid = all(identifier(r['media_id']) for r in refs if r['kind'] in ('video', 'photo'))
        valid = bool(refs) and all(r['owner_verified'] for r in refs) and len(identities) == 1 and media_valid
        prefix = bucket + '/' + name
        relative = prefix + '/' + obj['version'] if obj.get('version') else prefix
        entry = {'object_id': obj['id'], 'old_bucket': bucket, 'old_key': name, 'version': obj.get('version'),
            'physical_relative': relative, 'owner': refs[0]['owner'] if valid else None,
            'media_id': refs[0]['media_id'] if valid else None, 'references': refs,
            'proposed_location': next(iter(targets)) if valid and len(targets) == 1 else None,
            'catalog_size': obj.get('size'), 'decision': 'REVIEW', 'exists': None, 'bytes': None,
            'sha256': None, 'probe': None, 'migration_status': 'not_started'}
        if bucket in ('messenger-attachments', 'media-staging', 'file-previews'):
            entry['decision'] = 'KEEP'
            entry['reason'] = 'Protected staging/cache/Messenger object; separate job/reference audit required'
        elif entry['proposed_location']:
            entry['reason'] = 'Mapped proposal only; backup, copy verification and transactional cutover pending'
        else:
            entry['reason'] = 'Unknown/conflicting owner, reference, original retention or destination; never auto-delete'
        if base:
            try:
                path = local_file(base, relative)
                physical_index[str(path)] = entry
                entry['exists'] = path.is_file()
                if entry['exists']:
                    stat = path.stat()
                    entry.update(bytes=stat.st_size, uid=getattr(stat, 'st_uid', None), gid=getattr(stat, 'st_gid', None), mode=oct(stat.st_mode & 0o777))
                    if hashes:
                        entry['sha256'] = checksum(path)
                    if probes and any(r['role'] == 'active_video' for r in refs):
                        entry['probe'] = probe_video(path)
                        if not entry['probe']['valid']:
                            entry.update(proposed_location=None, reason='Active video did not pass ffprobe MP4/video/duration verification')
                    if obj.get('size') is None or int(obj['size']) != stat.st_size:
                        entry['proposed_location'] = None
                        entry['reason'] = 'Missing catalog size or physical/catalog size mismatch'
                else:
                    entry['proposed_location'] = None
                    entry['reason'] = 'Catalog object has no physical payload at the exact versioned key'
            except (ValueError, OSError):
                entry.update(proposed_location=None, reason='Unsafe/unreadable physical source; review required')
        rows.append(entry)

    destinations = Counter(r['proposed_location'] for r in rows if r['proposed_location'])
    for row in rows:
        if row['proposed_location'] and destinations[row['proposed_location']] > 1:
            row.update(proposed_location=None, reason='Destination collision; review required')
    originals = []
    for row in snapshot.get('videos') or []:
        refs = [r for r in rows if any(x.get('kind') == 'video' and x.get('media_id') == row['id'] for x in r['references'])]
        original = next((r for r in refs if any(x['role'] == 'original_requires_review' for x in r['references'])), None)
        final = next((r for r in refs if any(x['role'] == 'active_video' for x in r['references'])), None)
        status = row.get('processing_status') or row.get('status')
        active = [j['id'] for j in snapshot.get('jobs') or [] if (j.get('id') == row['id'] or j.get('target_video_id', j.get('target')) == row['id']) and j.get('status') in ACTIVE | {'error', 'failed'}]
        decision = 'KEEP' if not original else 'REVIEW'
        originals.append({'video_id': row['id'], 'owner': owner(row), 'source_path': row.get('storage_path'),
            'source_size': (original or final or {}).get('bytes'), 'final_path': row.get('processed_storage_path') or row.get('storage_path'),
            'final_size': (final or {}).get('bytes'), 'status': status, 'active_db_path': row.get('processed_storage_path') or row.get('storage_path'),
            'probe': (final or {}).get('probe'), 'dependent_or_failed_jobs': active, 'decision': decision,
            'reason': 'Active file is the original/final fallback; retain' if not original else
                'Original remains referenced by videos.storage_path; verify reference migration, publication contracts and retry safety before cleanup'})
    return {'manifest': rows, 'unresolved_references': missing, 'originals': originals}, physical_index


def timestamp(value):
    try:
        result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return result if result.tzinfo else None
    except ValueError:
        return None


def inspect_files(base, snapshot, physical_index, now=None):
    """Age/offset alone never establish that a resumable upload may be removed."""
    now = now or datetime.now(timezone.utc)
    reports, unknown, errors, seen, total, allocated = [], [], [], set(), 0, 0
    allocation_available = True
    jobs = snapshot.get('jobs') or []
    def scan_error(error):
        errors.append({'path': str(error.filename), 'reason': type(error).__name__})
    for directory, dirs, files in os.walk(base, followlinks=False, onerror=scan_error):
        parent = Path(directory)
        for name in list(dirs):
            if (parent / name).is_symlink():
                unknown.append({'path': str((parent / name).relative_to(base)), 'reason': 'symlink directory not traversed'})
                dirs.remove(name)
        for name in files:
            path = parent / name
            relative = path.relative_to(base).as_posix()
            if path.is_symlink():
                unknown.append({'path': relative, 'reason': 'symlink not read'})
                continue
            try:
                stat = path.stat()
            except OSError as error:
                scan_error(error)
                continue
            total += stat.st_size
            if not hasattr(stat, 'st_blocks'):
                allocation_available = False
            elif (stat.st_dev, stat.st_ino) not in seen:
                allocated += stat.st_blocks * 512
                seen.add((stat.st_dev, stat.st_ino))
            known = str(path) in physical_index
            if path.suffix.lower() != '.json':
                if not known:
                    unknown.append({'path': relative, 'bytes': stat.st_size, 'reason': 'physical file absent from catalog; retain'})
                continue
            record = {'path': relative, 'bytes': stat.st_size, 'type': 'D', 'decision': 'KEEP',
                'age_seconds': None, 'offset': None, 'related_object': None, 'status': 'unknown'}
            if known:
                record.update(type='C', status='catalogued application content', reason='Never classify user JSON as disposable TUS state')
            elif stat.st_size <= 1024 * 1024:
                try:
                    data = json.loads(path.read_text())
                    meta = data.get('metadata') if isinstance(data, dict) else None
                    if isinstance(meta, dict) and key(meta.get('bucketName')) and key(meta.get('objectName')) and 'size' in data and 'offset' in data:
                        created = timestamp(data.get('creation_date'))
                        record.update(related_object=meta['bucketName'] + '/' + meta['objectName'], offset=data['offset'],
                            upload_size=data['size'], age_seconds=(now - created).total_seconds() if created else None,
                            status='TUS-like metadata; backend expiration/lock state not verified')
                        active = any(owner(j) and j.get('id') and meta['bucketName'] == 'media-staging' and
                            meta['objectName'] in (owner(j) + '/' + j['id'] + '/source', owner(j) + '/' + j['id'] + '/preview') and
                            j.get('status') in ACTIVE for j in jobs)
                        if active:
                            record.update(type='A', status='related upload/processing job active')
                        record['reason'] = 'Retain; inspect installed Storage/TUS expiry, locks, payload and retry references before backend cleanup'
                    else:
                        record['reason'] = 'Unrecognized JSON; retain for manual review'
                except (ValueError, OSError):
                    record['reason'] = 'Unreadable or invalid JSON; retain for manual review'
            else:
                record['reason'] = 'JSON exceeds metadata inspection limit; retain for manual review'
            reports.append(record)
    storage_du = None
    if os.name == 'posix':
        try:
            measured = subprocess.run(['du', '-s', '-B1', '--', str(base)], capture_output=True, text=True, timeout=45)
            if measured.returncode == 0:
                storage_du = int(measured.stdout.split()[0])
        except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
            pass  # An unavailable measurement remains unknown, never an invented zero.
    return {'json': reports, 'unknown_files': unknown, 'scan_errors': errors, 'storage_logical_bytes_before': total,
        'storage_allocated_payload_bytes_before': allocated if allocation_available else None,
        'storage_du_bytes_before': storage_du}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True, help='Private read-only database snapshot JSON')
    parser.add_argument('--storage-base', help='Exact GLOBAL_S3_BUCKET/TENANT_ID directory on the Docker host')
    parser.add_argument('--output', required=True, help='New private report directory, outside Storage')
    parser.add_argument('--checksums', action='store_true', help='Read payloads to calculate SHA-256; can be I/O intensive')
    parser.add_argument('--probe-videos', action='store_true', help='Run read-only ffprobe on active video payloads')
    args = parser.parse_args()
    snapshot = json.loads(Path(args.snapshot).read_text(encoding='utf-8-sig'))
    if not all(name in snapshot for name in ('objects', 'videos', 'photos', 'file_metadata', 'jobs', 'users', 'storage_settings')):
        parser.error('Incomplete database snapshot; refusing to guess missing records')
    base = Path(args.storage_base).resolve(strict=True) if args.storage_base else None
    output = Path(args.output).absolute()
    if base and output.resolve().is_relative_to(base):
        parser.error('Reports must not be written inside Storage')
    if output.exists() or output.is_symlink():
        parser.error('Use a new report directory; existing reports are never overwritten')
    report, physical = make_manifest(snapshot, base, args.checksums, args.probe_videos)
    disk = inspect_files(base, snapshot, physical) if base else {'json': [], 'unknown_files': [], 'scan_errors': [],
        'storage_logical_bytes_before': None, 'storage_allocated_payload_bytes_before': None, 'storage_du_bytes_before': None}
    volume = shutil.disk_usage(base) if base else None
    summary = {'phase': '0; read-only; no migration or cleanup executed', 'snapshot_at': snapshot.get('captured_at'),
        'users': len(snapshot['users']), 'videos': len(snapshot['videos']), 'photos': len(snapshot['photos']),
        'file_metadata': len(snapshot['file_metadata']), 'catalog_objects': len(snapshot['objects']),
        'physical_scan_completed': bool(base) and not disk['scan_errors'],
        'json_counts': {letter: sum(r['type'] == letter for r in disk['json']) for letter in 'ABCD'} if base else None,
        'proposed_objects': sum(bool(r['proposed_location']) for r in report['manifest']),
        'unresolved_references': len(report['unresolved_references']), 'unknown_files': len(disk['unknown_files']),
        'disk_usage_before_bytes': disk['storage_du_bytes_before'], 'logical_bytes_before': disk['storage_logical_bytes_before'],
        'allocated_payload_bytes_before': disk['storage_allocated_payload_bytes_before'],
        'filesystem_used_bytes_before': volume.used if volume else None,
        'disk_usage_after_original_cleanup_bytes': None, 'disk_usage_after_final_cleanup_bytes': None,
        'space_recovered_bytes': 0, 'originals_removed': 0, 'json_removed': 0, 'delete_candidates': 0,
        'users_migrated': 0, 'videos_migrated': 0, 'photos_migrated': 0, 'files_migrated': 0,
        'free_bytes': volume.free if volume else None,
        'rollback': 'No production changes; backups and restore verification still required',
        'notes': ['Proposed locations are logical Storage keys; physical tenant/version directories remain backend-managed.',
            'No age-only TUS expiry inference. Category B requires installed-backend expiry and lock verification.',
            'No copy, cleanup, database update or apply mode exists in this tool.']}
    output.mkdir(mode=0o700, parents=True)
    for name, data in [('manifest.json', report), ('filesystem-and-tus.json', disk), ('summary.json', summary)]:
        descriptor = os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(data, handle, indent=2, allow_nan=False)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
