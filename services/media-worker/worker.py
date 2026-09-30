import concurrent.futures
import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote
import requests

URL = os.environ.get('SUPABASE_URL','').rstrip('/')
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
HEADERS = {'apikey':KEY, 'Authorization':'Bearer '+KEY}
LOG = logging.getLogger('media')
logging.basicConfig(level=logging.INFO,format='%(message)s')

class RejectedRequest(ValueError):
    pass

class CancelledUpload(ValueError):
    pass

def check_cancelled(job_id):
    rows=api('GET','/rest/v1/media_upload_jobs?id=eq.'+job_id+'&select=status')
    if not rows or rows[0]['status'] in ('cancelling','cancelled'):
        raise CancelledUpload('Video deletion requested.')

def api(method, path, **kwargs):
    headers = {**HEADERS, **kwargs.pop('headers',{})}
    response = requests.request(method,URL+path,headers=headers,timeout=(10,120),**kwargs)
    if 400 <= response.status_code < 500:
        try: code=response.json().get('code')
        except Exception: code=None
        message='The server rejected this upload. Please try again.'
        if path == '/rest/v1/photos' and code == '23505': message='A photo with this name already exists. Choose another name.'
        if path == '/rest/v1/photos' and code == '22023': message='The photo name contains invalid characters. Choose another name.'
        raise RejectedRequest(message)
    response.raise_for_status()
    return response.json() if response.content else None

def job_update(job_id, **values):
    return api('PATCH','/rest/v1/media_upload_jobs?id=eq.'+job_id,json=values)

def download(path, destination, maximum):
    with requests.get(URL+'/storage/v1/object/authenticated/media-staging/'+quote(path,safe='/'),
                      headers=HEADERS,stream=True,timeout=(10,120)) as response:
        response.raise_for_status()
        total=0
        with destination.open('wb') as output:
            for chunk in response.iter_content(1024*1024):
                total+=len(chunk)
                if total>maximum: raise ValueError('File exceeds the upload size limit.')
                output.write(chunk)
        if not total: raise ValueError('Empty files cannot be uploaded.')
        return total

def upload(bucket,path,source,mime,created):
    with source.open('rb') as content:
        api('POST','/storage/v1/object/'+bucket+'/'+quote(path,safe='/'),
            headers={'Content-Type':mime,'x-upsert':'false'},data=content)
    created.append((bucket,path))

def remove(bucket,paths):
    if paths: api('DELETE','/storage/v1/object/'+bucket,json={'prefixes':paths})

def validate(kind,source,directory,job_id=None):
    command=[sys.executable,str(Path(__file__).with_name('validate.py')),kind,str(source),str(directory)]
    process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,
                             env={'PATH':os.environ.get('PATH',''),'HOME':'/tmp','PYTHONUNBUFFERED':'1'})
    deadline=time.monotonic()+(7620 if kind=='video' else 120)
    try:
        while True:
            if job_id: check_cancelled(job_id)
            if time.monotonic()>deadline: raise ValueError('Media processing timed out.')
            try:
                stdout,_=process.communicate(timeout=2)
                break
            except subprocess.TimeoutExpired: continue
    except BaseException:
        # Terminate the validator and its FFmpeg descendants before releasing
        # the job for deletion or removing its temporary directory.
        try: os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        process.communicate()
        raise
    try: metadata=json.loads(stdout)
    except Exception: raise ValueError('Media decoding failed or exceeded processing limits.')
    if metadata.get('diagnostic'):
        LOG.error(json.dumps({'operation':'media_decoder','id':job_id,'diagnostic':metadata['diagnostic']}))
    for diagnostic in metadata.get('diagnostics',[]):
        LOG.warning(json.dumps({'operation':'media_decoder_recovery','id':job_id,'diagnostic':diagnostic}))
    if process.returncode or metadata.get('error'): raise ValueError(metadata.get('error','Media validation failed.'))
    return metadata

def process(job):
    jid,owner,kind=job['id'],job['owner_id'],job['kind']
    prefix=owner+'/'+jid
    created=[]
    published=False
    publication_attempted=False
    error=None
    cancelled=False
    try:
        with tempfile.TemporaryDirectory(prefix='media-',dir='/work') as temporary:
            directory=Path(temporary)
            source=directory/'source'
            size=download(prefix+'/source',source,10*1024**3 if kind=='video' else 25*1024**2)
            check_cancelled(jid)
            metadata=validate(kind,source,directory,jid)
            check_cancelled(jid)
            rows=api('GET','/rest/v1/storage_settings?id=eq.1&select=videos_base_path,images_base_path') or [{}]
            settings=rows[0]
            def full(path,bucket):
                base=(settings.get('videos_base_path' if bucket=='user-videos' else 'images_base_path') or '').strip('/')
                return base+'/'+path if base else path
            users=api('GET','/rest/v1/profiles?id=eq.'+owner+'&select=email')
            if not users: raise ValueError('Upload owner no longer exists.')
            record={'id':jid,'owner_id':owner,'owner_email':users[0]['email'],'file_name':job['file_name'],
                    'visibility':job['visibility'],'file_size':size,'mime_type':metadata['mime_type']}
            if kind=='preview':
                path=owner+'/video-previews/'+job['target_video_id']+'/'+jid+'.webp'
                upload('user-images',full(path,'user-images'),directory/'preview.webp','image/webp',created)
                result={'path':path}
            elif kind=='photo':
                base=owner+'/photos/'+jid
                original=base+'/original.'+metadata['extension']
                for path,name,mime in [(original,'source',metadata['mime_type']),(base+'/preview.webp','preview.webp','image/webp'),(base+'/thumbnail.webp','thumbnail.webp','image/webp')]:
                    upload('user-images',full(path,'user-images'),directory/name,mime,created)
                record.update(storage_path=original,preview_path=base+'/preview.webp',thumbnail_path=base+'/thumbnail.webp',width=metadata['width'],height=metadata['height'])
                publication_attempted=True
                api('POST','/rest/v1/photos',json=record)
                published=True
                result={'id':jid}
            else:
                base=owner+'/videos/'+jid
                original=base+'/original.'+metadata['extension']
                processed=base+'/stream.mp4'
                preview=owner+'/video-previews/'+jid+'/preview.webp'
                if job['has_preview']:
                    custom=directory/'custom'
                    custom.mkdir()
                    download(prefix+'/preview',custom/'source',25*1024**2)
                    validate('photo',custom/'source',custom,jid)
                    preview_source=custom/'preview.webp'
                else: preview_source=directory/'preview.webp'
                upload('user-videos',full(original,'user-videos'),source,metadata['mime_type'],created)
                upload('user-videos',full(processed,'user-videos'),directory/'stream.mp4','video/mp4',created)
                upload('user-images',full(preview,'user-images'),preview_source,'image/webp',created)
                record.update(storage_path=original,processed_storage_path=processed,preview_path=preview,processing_status='ready',
                    container_format=metadata['format'],video_codec=metadata['video_codec'],video_bitrate=round(metadata['video_bitrate']) if metadata['video_bitrate'] is not None else None,
                    frame_rate=metadata['frame_rate'],source_metadata=metadata['source_metadata'],
                    processing_action=metadata['processing_action'],audio_codec=metadata['audio_codec'],audio_bitrate=metadata['audio_bitrate'],
                    processed_file_size=(directory/'stream.mp4').stat().st_size,
                    resolution_width=metadata['width'],resolution_height=metadata['height'],duration_seconds=metadata['duration_seconds'])
                publication_attempted=True
                api('POST','/rest/v1/videos',json=record)
                published=True
                result={'id':jid}
            publication_attempted=True
            job_update(jid,status='complete',result=result,finished_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
            published=True  # A preview now has a validated result usable by its owner.
            LOG.info(json.dumps({'operation':'media_validation','id':jid,'result':'complete','kind':kind}))
    except Exception as cause:
        try:
            check_cancelled(jid)
        except CancelledUpload:
            cancelled=True
        except Exception:
            pass  # An unavailable API cannot prove that cleanup is safe.
        # Never relay provider response bodies, paths, credentials, or decoder logs.
        error=str(cause) if isinstance(cause,ValueError) else 'Could not validate or save this file. It may be corrupted, unsupported, or exceed processing limits.'
        if isinstance(cause,RejectedRequest): publication_attempted=False
        if publication_attempted:
            error='The upload may have completed, but its status could not be confirmed. Check your gallery before retrying.'
        LOG.error(json.dumps({'operation':'media_validation','id':jid,'result':'error','type':type(cause).__name__}))
        # A lost HTTP response may hide a committed row/result. Retain its
        # objects rather than deleting media that may already be published.
        if not published and not publication_attempted:
            for bucket,path in created:
                try: remove(bucket,[path])
                except Exception: LOG.error(json.dumps({'operation':'temporary_media_cleanup','id':jid,'result':'error'}))
        try: job_update(jid,status='error',error=error,finished_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
        except Exception: LOG.error(json.dumps({'operation':'media_job_status','id':jid,'result':'error'}))
    finally:
        # Retain a failed video's original in private staging for recovery.
        # Successful videos also retain their original in final video storage.
        if kind != 'video' or published or cancelled:
            try: remove('media-staging',[prefix+'/source',prefix+'/preview'])
            except Exception: LOG.error(json.dumps({'operation':'staging_cleanup','id':jid,'result':'error'}))
        # All local processing/files are stopped now. The deletion endpoint owns
        # final storage cleanup (including ambiguous upload responses).
        try:
            check_cancelled(jid)
        except CancelledUpload:
            job_update(jid,status='cancelled',result=None,error=None)
        except Exception:
            LOG.error(json.dumps({'operation':'media_cancel_status','id':jid,'result':'error'}))

def main():
    if not URL or not KEY: raise RuntimeError('Media worker server credentials are not configured')
    # Decoder capability self-check: do not silently advertise missing codecs.
    from PIL import Image, features
    from pillow_heif import register_heif_opener
    register_heif_opener(); Image.init()
    if not features.check('webp') or not features.check('avif') or 'HEIF' not in Image.OPEN:
        raise RuntimeError('Required image codecs are unavailable')
    subprocess.run(['ffmpeg','-version'],check=True,stdout=subprocess.DEVNULL)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        active=set()
        while True:
            active={future for future in active if not future.done()}
            try:
                stale=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(time.time()-10800))
                api('PATCH','/rest/v1/media_upload_jobs?status=eq.processing&started_at=lt.'+stale,
                    json={'status':'error','error':'Processing was interrupted. Please upload the file again.'})
                if len(active)<2:
                    jobs=api('GET','/rest/v1/media_upload_jobs?status=eq.queued&order=created_at&limit='+str(2-len(active)))
                    for job in jobs:
                        claimed=api('PATCH','/rest/v1/media_upload_jobs?id=eq.'+job['id']+'&status=eq.queued',
                            headers={'Prefer':'return=representation'},json={'status':'processing','started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
                        if claimed: active.add(pool.submit(process,claimed[0]))
                Path('/tmp/media-heartbeat').touch()
            except Exception as cause: LOG.error(json.dumps({'operation':'media_worker_poll','type':type(cause).__name__}))
            time.sleep(2)
if __name__=='__main__': main()
