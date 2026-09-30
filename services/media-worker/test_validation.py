import json
import subprocess
import tempfile
from pathlib import Path
from PIL import Image
from pillow_heif import register_heif_opener
from validate import photo, video, InvalidMedia
register_heif_opener()
checks=0
def check(label):
    global checks
    checks+=1
    print('PASS '+label,flush=True)
with tempfile.TemporaryDirectory() as temp:
    root=Path(temp)
    for fmt,ext in [('JPEG','jpg'),('PNG','png'),('GIF','gif'),('WEBP','webp'),('BMP','bmp'),('TIFF','tif'),('AVIF','avif'),('HEIF','heic')]:
        source=root/('image.'+ext)
        Image.new('RGB',(64,48),'blue').save(source,fmt)
        destination=root/('image-'+ext);destination.mkdir()
        result=photo(source,destination)
        assert result['width']==64 and (destination/'thumbnail.webp').is_file()
        try: video(source,destination)
        except InvalidMedia: pass
        else: raise AssertionError('Image accepted as video: '+fmt)
        check(fmt+' image decoding, thumbnails, and video rejection')
    specs=[('mp4','libx264','mp4'),('mov','libx264','mov'),('avi','mpeg4','avi'),('mkv','libx264','matroska'),('wmv','wmv2','asf'),('webm','libvpx','webm'),('mpg','mpeg2video','mpeg'),('m4v','libx264','mp4'),('3gp','h263','3gp'),('ts','libx264','mpegts'),('mts','libx264','mpegts'),('m2ts','libx264','mpegts'),('ogv','libtheora','ogg'),('flv','flv','flv'),('nut','ffv1','nut')]
    for ext,codec,fmt in specs:
        source=root/('video.'+ext)
        audio=['-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-c:a',('wmav2' if ext=='wmv' else 'pcm_s16le' if ext=='avi' else 'aac')] if ext in ['mp4','mov','avi','mkv','wmv'] else ['-an']
        cmd=['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=128x96:rate=25',*audio,'-t','0.4','-c:v',codec,'-threads','1','-f',fmt,str(source)]
        subprocess.run(cmd,check=True)
        destination=root/('video-'+ext);destination.mkdir()
        result=video(source,destination)
        assert (destination/'stream.mp4').is_file() and result['duration_seconds']>0
        try: photo(source,destination)
        except InvalidMedia: pass
        else: raise AssertionError('Video accepted as photo: '+ext)
        check(ext+' full video decoding, MP4 conversion and photo rejection')
    for name,content in [('malware.mp4',b'MZ'+bytes(1024)),('malware.jpg',b'MZ'+bytes(1024)),('broken.png',b'\x89PNG\r\n\x1a\n'+bytes(24)),('broken.mp4',(root/'video.mp4').read_bytes()[:40]),('document.mp4',b'%PDF-1.4 fake')]:
        source=root/name;source.write_bytes(content)
        dest=root/(name+'-out');dest.mkdir()
        for validator in [photo,video]:
            try: validator(source,dest)
            except Exception: pass
            else: raise AssertionError('Invalid content accepted: '+name)
        check(name+' rejected by both decoders')
    disguised=root/'wrong-extension.exe';disguised.write_bytes((root/'image.jpg').read_bytes())
    dest=root/'actual-content';dest.mkdir()
    assert photo(disguised,dest)['mime_type']=='image/jpeg'
    check('backend identifies real image independently of filename')
    playlist=root/'playlist.mp4';playlist.write_text('file /etc/passwd')
    try: video(playlist,root)
    except Exception: pass
    else: raise AssertionError('Playlist accepted')
    check('playlist/file reference rejected')
print(str(checks)+' decoder checks passed')
