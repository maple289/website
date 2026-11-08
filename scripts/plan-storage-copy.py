#!/usr/bin/env python3
"""Read-only construction of verified, private preparatory copies.

Files preserve their existing hierarchy beneath the immutable owner's files/
prefix. File public IDs and sharing remain database metadata. Sharing changes
never move/copy objects. Old folder markers remain until catalog cutover.
"""
from uuid import UUID


def make_copy_plan(snapshot, audited):
    current={(r['bucket'],r['name']):r for r in snapshot['objects']}
    file_rows={r['object_path']:r for r in snapshot['file_metadata']}
    result=[];seen=set()
    for obj in audited['report']['manifest']:
        if not obj.get('proposed_location'):
            continue
        if any(r['role']=='folder_marker' for r in obj['references']):
            continue  # Preserve virtual folders/shares in DB, not physical sharing trees.
        source=current.get((obj['old_bucket'],obj['old_key']))
        if not source or any(source[k]!=obj[v] for k,v in [('id','object_id'),('version','version')]):
            raise ValueError('Audited object identity/version changed')
        if str(source['size'])!=str(obj['bytes']) or not obj['exists'] or not obj['sha256']:
            raise ValueError('Missing, unverified or size-mismatched source')
        if obj['owner'] not in snapshot['users'] or str(UUID(obj['owner']))!=obj['owner']:
            raise ValueError('Unverified owner UUID')
        if any(not ref['owner_verified'] for ref in obj['references']):raise ValueError('Conflicting ownership')
        destination=obj['proposed_location']
        resource_id=obj['media_id']
        if obj['old_bucket']=='user-files':
            metadata=file_rows.get(obj['old_key'])
            if not metadata or metadata['is_folder'] or metadata['owner_id']!=obj['owner']:
                raise ValueError('No matching owned file metadata')
            resource_id=metadata['public_id']
            if str(UUID(resource_id))!=resource_id:raise ValueError('File requires an immutable database UUID')
            if metadata.get('source_id') and metadata['source_id']!=source['id']:
                raise ValueError('File catalog identity mismatch')
            relative=metadata['object_path'][len(obj['owner'])+1:]
            destination=f"users/{obj['owner']}/files/{relative}"
        if any(ref['role']=='active_video' for ref in obj['references']):
            if not obj.get('probe',{}).get('valid'):raise ValueError('Final video not validated')
        if destination in seen:raise ValueError('Destination collision')
        seen.add(destination)
        bucket,key=destination.split('/',1)
        if bucket!='users' or not key.startswith(obj['owner']+'/') or any(p in ('','.','..') or '\\' in p for p in key.split('/')):
            raise ValueError('Unsafe UUID destination')
        result.append({'source':obj,'destination_bucket':bucket,'destination_key':key,
            'owner_uuid':obj['owner'],'resource_uuid':resource_id,'status':'planned_private_copy',
            'source_retained':True,'active_references_changed':False})
    return {'objects':result,'count':len(result),'bytes':sum(r['source']['bytes'] for r in result),
        'application_cutover':False,'destination_public':False,'folder_markers_copied':0}
