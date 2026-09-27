import json
import subprocess
import sys
import warnings
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener()
Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
IMAGES = {'JPEG': ('jpg', 'image/jpeg'), 'PNG': ('png', 'image/png'),
          'GIF': ('gif', 'image/gif'), 'WEBP': ('webp', 'image/webp'),
          'BMP': ('bmp', 'image/bmp'), 'TIFF': ('tif', 'image/tiff'),
          'AVIF': ('avif', 'image/avif'), 'HEIF': ('heic', 'image/heic')}
# Standalone containers only: playlists, concat, image sequences and network
# protocols are deliberately unavailable to untrusted inputs.
CONTAINERS = 'mov,matroska,webm,avi,asf,mpeg,mpegvideo,mpegts,flv,ogg,rm,mxf,nut'
FORMATS = {'mov': ('mov','video/quicktime'), 'mp4': ('mp4','video/mp4'),
           'matroska': ('mkv','video/x-matroska'), 'webm': ('webm','video/webm'),
           'avi': ('avi','video/x-msvideo'), 'asf': ('wmv','video/x-ms-wmv'),
           'mpeg': ('mpg','video/mpeg'), 'mpegvideo': ('mpg','video/mpeg'),
           'mpegts': ('ts','video/mp2t'), 'flv': ('flv','video/x-flv'),
           'ogg': ('ogv','video/ogg'), 'rm': ('rm','application/vnd.rn-realmedia'),
           'mxf': ('mxf','application/mxf'), 'nut': ('nut','video/x-nut')}
class InvalidMedia(Exception): pass

def run(args, timeout=120):
    try:
        return subprocess.run(args, check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise InvalidMedia('The file is corrupted, unsupported, or exceeded the processing limit.') from error

def photo(source, destination):
    try:
        with Image.open(source) as image:
            fmt = image.format
            if fmt not in IMAGES: raise InvalidMedia('The Photos section accepts supported image files only.')
            image.verify()
        with Image.open(source) as image:
            frames = getattr(image, 'n_frames', 1)
            if frames > 1000: raise InvalidMedia('This image has too many frames (maximum 1000).')
            pixels = 0
            for frame in range(frames):
                image.seek(frame)
                pixels += image.width * image.height
                if pixels > 200_000_000: raise InvalidMedia('This image exceeds the decoded image size limit.')
                image.load()  # Validate actual pixels, not just the header.
            image.seek(0)
            image = ImageOps.exif_transpose(image).convert('RGBA')
            width, height = image.size
            for name, size, quality in [('preview',1600,84), ('thumbnail',480,78)]:
                copy = image.copy()
                copy.thumbnail((size,size))
                copy.save(destination / (name+'.webp'), 'WEBP', quality=quality, exif=b'', icc_profile=None)
        ext, mime = IMAGES[fmt]
        return dict(extension=ext, mime_type=mime, width=width, height=height, format=fmt)
    except InvalidMedia: raise
    except Exception as error:
        raise InvalidMedia('The file is not a decodable supported image, or exceeds the image safety limits.') from error

def probe(source):
    return json.loads(run(['ffprobe','-v','error','-protocol_whitelist','file',
        '-format_whitelist',CONTAINERS,'-show_format','-show_streams','-of','json',str(source)]))

def video(source, destination):
    try:
        with Image.open(source):
            raise InvalidMedia('The Videos section accepts video files only, not still or animated images.')
    except UnidentifiedImageError: pass
    info = probe(source)
    streams = [s for s in info.get('streams',[]) if s.get('codec_type') == 'video' and not s.get('disposition',{}).get('attached_pic')]
    if not streams: raise InvalidMedia('The file contains no playable video stream.')
    stream = streams[0]
    width, height = int(stream.get('width',0)), int(stream.get('height',0))
    if width < 2 or height < 2 or width*height > 40_000_000: raise InvalidMedia('Unsupported video dimensions.')
    duration = float(info.get('format',{}).get('duration',0))
    if duration > 14400: raise InvalidMedia('Videos must be four hours or shorter.')
    formats = info.get('format',{}).get('format_name','').split(',')
    detected = next((f for f in formats if f in FORMATS), None)
    if not detected: raise InvalidMedia('Unsupported standalone video container.')
    # A complete decode/transcode is required before publication. -xerror makes
    # decoding errors fatal; metadata probing alone is never a readiness check.
    run(['ffmpeg','-nostdin','-v','error','-xerror','-err_detect','explode',
         '-protocol_whitelist','file','-format_whitelist',CONTAINERS,'-i',str(source),
         '-map','0:'+str(stream['index']),'-map','0:a:0?','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2',
         '-c:v','libx264','-preset','veryfast','-b:v','2000k','-maxrate','2000k',
         '-bufsize','4000k','-pix_fmt','yuv420p','-threads','2','-c:a','aac',
         '-map_metadata','-1','-movflags','+faststart',str(destination/'stream.mp4')],3600)
    output = probe(destination/'stream.mp4')
    if float(output.get('format',{}).get('duration',0)) <= 0: raise InvalidMedia('The video has no decodable duration.')
    run(['ffmpeg','-nostdin','-v','error','-i',str(destination/'stream.mp4'),
         '-frames:v','1','-vf','scale=640:-2',str(destination/'preview.webp')])
    ext, mime = FORMATS[detected]
    return dict(extension=ext, mime_type=mime, width=width, height=height,
                duration_seconds=float(output['format']['duration']), format=detected)

if __name__ == '__main__':
    try:
        result = (video if sys.argv[1]=='video' else photo)(Path(sys.argv[2]), Path(sys.argv[3]))
        print(json.dumps(result))
    except InvalidMedia as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'Media validation failed. The file may be corrupted or unsupported.'}))
        sys.exit(1)
