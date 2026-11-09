#!/usr/bin/env python3
"""Pure, read-only Phase-1 planner. This module cannot delete or update anything.

An apply operator must recheck these identities under a controlled write gate,
reconcile videos.storage_path transactionally, then use the Storage API. The
encrypted backup and its restore verification are a separate mandatory gate.
"""
import math
from uuid import UUID


def canonical_uuid(value):
    try:
        return str(UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        return False


def plan(snapshot, audit, reference_counts, verified_backup_files):
    objects = {(r['old_bucket'], r['old_key']): r for r in audit['report']['manifest']}
    settings = snapshot['storage_settings']
    prefix = (settings.get('videos_base_path') or '').strip('/')
    catalog_key = lambda path: '/'.join(filter(None, [prefix, path]))
    users = set(snapshot['users'])
    rows = []
    for video in snapshot['videos']:
        vid, owner = video['id'], video['owner_id']
        source = video.get('storage_path')
        final = video.get('processed_storage_path') or source
        src, dst = objects.get(('user-videos', catalog_key(source))), objects.get(('user-videos', catalog_key(final)))
        row = {'video_id':vid, 'owner_uuid':owner, 'source_path':source,
               'source_size':src.get('bytes') if src else None, 'final_path':final,
               'final_size':dst.get('bytes') if dst else None,
               'processing_status':video.get('processing_status'), 'active_db_path':final,
               'decision':'REVIEW', 'reasons':[], 'source':src, 'final':dst}
        rows.append(row)
        if source == final:
            row.update(decision='KEEP', reasons=['Source is the active final object; never delete a sole/no-conversion MP4'])
            continue
        checks = {
            'Canonical database owner and media UUIDs': canonical_uuid(owner) and canonical_uuid(vid) and owner in users,
            'Ready video with active processed MP4': video.get('processing_status') == 'ready' and video.get('processed_storage_path') == final and final.endswith('.mp4'),
            'Source and final belong to this media': bool(src and dst) and all(r['owner'] == owner and r['media_id'] == vid for r in [src,dst] if r),
            'Source/final physically exist and match catalog size': bool(src and dst) and all(r.get('exists') and r.get('bytes',0)>0 and str(r['bytes']) == str(r.get('catalog_size')) for r in [src,dst] if r),
            'No pending, failed, retry or recovery dependency': not any(j['status'] != 'complete' and (j['id']==vid or j.get('target_video_id')==vid) for j in snapshot['jobs']),
            'Only the known primary database reference remains': reference_counts.get(source) == [{'table':'videos','rows':1}],
        }
        probe = dst.get('probe') if dst else None
        duration = probe.get('duration') if probe else None
        checks['Verified video stream and positive finite duration'] = bool(probe and probe.get('valid') and probe.get('codec')) and isinstance(duration,(int,float)) and math.isfinite(duration) and duration>0
        for label, obj in [('Source',src),('Final',dst)]:
            path = 'storage/stub/stub/'+obj['physical_relative'] if obj else ''
            saved = verified_backup_files.get(path)
            checks[label+' bytes are in the verified full backup'] = bool(saved and obj and saved['size']==obj['bytes'] and saved['sha256']==obj['sha256'])
        row['checks'] = checks
        row['reasons'] = [name for name, passed in checks.items() if not passed]
        if all(checks.values()):
            row.update(decision='DELETE CANDIDATE', reasons=['Reconcile storage_path to the verified final under the write gate before API deletion'])
    return {'rows':rows, 'potential_recovery_bytes':sum(r['source_size'] for r in rows if r['decision']=='DELETE CANDIDATE'),
            'mutation_count':0, 'apply_requires_fresh_verification':True}
