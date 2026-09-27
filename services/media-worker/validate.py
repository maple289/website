import json
import subprocess
import sys
import warnings
import tempfile
import math
from fractions import Fraction
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

def number(value):
    try:
        result = float(Fraction(str(value)))
        return result if math.isfinite(result) and result > 0 else None
    except (ValueError, ZeroDivisionError):
        return None


def container(info):
    names = info.get('format', {}).get('format_name', '').split(',')
    detected = next((name for name in names if name in FORMATS), None)
    if detected == 'mov':
        # FFprobe uses one demuxer name for MP4, MOV and 3GP. The brand,
        # rather than the uploaded extension, identifies the actual container.
        brand = info.get('format', {}).get('tags', {}).get('major_brand', '').strip().lower()
        if brand.startswith(('3gp', '3g2')):
            return '3gp', '3gp', 'video/3gpp'
        if brand and brand != 'qt':
            return 'mp4', 'mp4', 'video/mp4'
    if not detected:
        raise InvalidMedia('Unsupported standalone video container.')
    ext, mime = FORMATS[detected]
    return detected, ext, mime


def measured_bitrate(source, stream, duration):
    known = number(stream.get('bit_rate'))
    if known:
        return known
    if not duration:
        return None
    # Some containers omit stream bitrate. Count compressed packet bytes on
    # disk, without loading a potentially huge packet report into memory.
    with tempfile.TemporaryFile() as packets:
        try:
            subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file',
                '-format_whitelist', CONTAINERS, '-select_streams', str(stream['index']),
                '-show_entries', 'packet=size', '-of', 'csv=p=0', str(source)],
                stdout=packets, stderr=subprocess.DEVNULL, timeout=180, check=True)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            raise InvalidMedia('Could not measure the video bitrate safely.')
        packets.seek(0)
        total = sum(int(value) for line in packets if (value := line.split(b',')[0].strip()).isdigit())
    return total * 8 / duration if total else None


def video(source, destination):
    try:
        with Image.open(source):
            raise InvalidMedia('The Videos section accepts video files only, not still or animated images.')
    except UnidentifiedImageError:
        pass
    info = probe(source)
    streams = [s for s in info.get('streams', []) if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')]
    if not streams:
        raise InvalidMedia('The file contains no playable video stream.')
    stream = streams[0]
    width, height = int(stream.get('width', 0)), int(stream.get('height', 0))
    if width < 2 or height < 2 or width * height > 40_000_000:
        raise InvalidMedia('Unsupported video dimensions.')
    duration = number(stream.get('duration')) or number(info.get('format', {}).get('duration'))
    if duration and duration > 14400:
        raise InvalidMedia('Videos must be four hours or shorter.')
    detected, ext, mime = container(info)
    bitrate = measured_bitrate(source, stream, duration)
    fps = number(stream.get('avg_frame_rate')) or number(stream.get('r_frame_rate'))
    sar = number(str(stream.get('sample_aspect_ratio', '1:1')).replace(':', '/')) or 1
    rotated = any(float(item.get('rotation', 0)) % 360 for item in stream.get('side_data_list', []))
    compatible = (stream.get('codec_name') == 'h264' and stream.get('pix_fmt') == 'yuv420p'
                  and width <= 1920 and height <= 1080 and width % 2 == 0 and height % 2 == 0
                  and sar == 1 and not rotated)
    # All non-MP4 inputs are normalized; compliant MP4 video is stream-copied.
    transcode = detected != 'mp4' or not compatible or bitrate is None or bitrate > 2_500_000
    audio = next((s for s in info.get('streams', []) if s.get('codec_type') == 'audio'), None)
    audio_bitrate = number(audio.get('bit_rate')) if audio else None
    copy_audio = audio and audio.get('codec_name') == 'aac' and audio.get('profile') == 'LC' and audio_bitrate and 120_000 <= audio_bitrate <= 136_000
    source_metadata = dict(container=detected, video_codec=stream.get('codec_name'),
        video_bitrate=round(bitrate / 1000, 3) if bitrate else None, width=width, height=height,
        frame_rate=fps, duration_seconds=duration, audio_codec=audio.get('codec_name') if audio else None,
        audio_bitrate=round(audio_bitrate / 1000, 3) if audio_bitrate else None)
    command = ['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode',
        '-protocol_whitelist', 'file', '-format_whitelist', CONTAINERS, '-i', str(source),
        '-map', '0:' + str(stream['index']), '-map', '0:a:0?']
    if transcode:
        # Normalize display aspect ratio (including anamorphic sources) without
        # enlarging its display dimensions. FFmpeg autorotates before filtering.
        scale = "scale=w='trunc(min(iw*sar,min(1920,1080*dar))/2)*2':h='trunc(min(ih,min(1080,1920/dar))/2)*2',setsar=1"
        command += ['-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast',
            '-b:v', '2500k', '-minrate', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
            # MP4 does not support x264's nal-hrd=cbr signaling. Filler plus
            # matching VBV rates provides a tightly controlled constant target.
            '-x264-params', 'nal-hrd=vbr:filler=1', '-pix_fmt', 'yuv420p',
            '-threads', '2', '-fps_mode', 'passthrough', '-metadata:s:v:0', 'rotate=0']
    else:
        command += ['-c:v', 'copy']
    command += ['-c:a', 'copy'] if copy_audio and not transcode else ['-c:a', 'aac', '-b:a', '128k']
    playable = destination / 'stream.mp4'
    command += ['-map_metadata', '-1', '-movflags', '+faststart', str(playable)]
    run(command, 3600)
    output = probe(playable)
    output_video = next((s for s in output.get('streams', []) if s.get('codec_type') == 'video'), {})
    output_audio = next((s for s in output.get('streams', []) if s.get('codec_type') == 'audio'), None)
    output_duration = number(output.get('format', {}).get('duration'))
    if (not output_duration or output_duration > 14400 or output_video.get('codec_name') != 'h264'
        or output_video.get('width', 0) > 1920 or output_video.get('height', 0) > 1080
        or (output_audio and output_audio.get('codec_name') != 'aac')):
        raise InvalidMedia('The converted video did not meet the playback requirements.')
    # Stream copying does not decode packets. Fully decode the final artifact
    # before publishing, for both copied and re-encoded video/audio streams.
    run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode',
         '-protocol_whitelist', 'file', '-format_whitelist', CONTAINERS, '-i', str(playable),
         '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-'], 3600)
    run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(playable), '-frames:v', '1',
         '-vf', "scale='min(640,iw)':-2", str(destination / 'preview.webp')])
    output_bitrate = measured_bitrate(playable, output_video, output_duration)
    return dict(extension=ext, mime_type=mime, width=output_video['width'], height=output_video['height'],
        duration_seconds=output_duration, format='mp4', video_codec='h264',
        video_bitrate=round(output_bitrate / 1000, 3) if output_bitrate else None,
        frame_rate=number(output_video.get('avg_frame_rate')) or fps,
        source_metadata=source_metadata, processing_action='transcoded' if transcode else 'remuxed_without_video_reencoding',
        audio_codec=output_audio.get('codec_name') if output_audio else None,
        audio_bitrate=number(output_audio.get('bit_rate')) / 1000 if output_audio and number(output_audio.get('bit_rate')) else None)

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
