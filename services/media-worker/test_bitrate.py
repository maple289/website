"""Decision/command tests plus real FFmpeg conversions, entirely local fixtures."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from PIL import UnidentifiedImageError
import validate


class BitrateDecisions(unittest.TestCase):
    def scenario(self, bitrate=4_500_000, target=3, fmt='mp4', codec='h264', faststart=True, audio_codec='aac'):
        commands = []
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root/'source'; destination = root/'out'; destination.mkdir()
            source.write_bytes(b'fixture source')
            stream = dict(index=0, codec_type='video', codec_name=codec, pix_fmt='yuv420p', width=1280,
                          height=720, duration='2', avg_frame_rate='25/1', sample_aspect_ratio='1:1')
            audio = dict(codec_type='audio', codec_name=audio_codec, profile='LC', bit_rate='512000')
            info = dict(format=dict(format_name='mov,mp4,m4a,3gp,3g2,mj2', duration='2', bit_rate='6500000',
                        tags={'major_brand': 'isom' if fmt == 'mp4' else 'qt'}), streams=[stream, audio])
            output = dict(format=dict(duration='2'), streams=[{**stream, 'codec_name': 'h264'}, {**audio, 'codec_name': 'aac'}])
            def run(command, timeout=120):
                commands.append(command)
                if command[-1].endswith('stream.mp4'): Path(command[-1]).write_bytes(b'converted')
                return b''
            with patch.object(validate.Image, 'open', side_effect=UnidentifiedImageError()), \
                 patch.object(validate, 'probe', side_effect=[info, output]), \
                 patch.object(validate, 'run', side_effect=run), \
                 patch.object(validate, 'mp4_faststart', return_value=faststart), \
                 patch.object(validate, 'measured_bitrate', side_effect=[bitrate, 3_000_000]):
                result = validate.video(source, destination, target)
            if result['processing_action'] == 'kept_original':
                self.assertEqual(source.read_bytes(), (destination/'stream.mp4').read_bytes())
        conversion = next((c for c in commands if '-c:v' in c), None)
        return result, conversion

    def test_mp4_threshold_inclusive_and_independent_of_target_and_audio(self):
        for bitrate in [1_800_000, 2_500_000, 3_200_000, 3_800_000, 4_000_000, 4_500_000]:
            for target in [1, 3, 15]:
                with self.subTest(bitrate=bitrate, target=target):
                    result, command = self.scenario(bitrate=bitrate, target=target)
                    self.assertEqual(result['processing_action'], 'kept_original')
                    self.assertIsNone(command)

    def test_high_mp4_and_non_mp4_use_configured_rate_and_double_buffer(self):
        for fmt, bitrate in [('mp4', 4_500_001), ('mp4', 5_000_000), ('mp4', 10_000_000), ('mov', 3_000_000)]:
            for target in [2.5, 3, 3.5, 4, 4.5, 15]:
                with self.subTest(fmt=fmt, bitrate=bitrate, target=target):
                    result, command = self.scenario(bitrate=bitrate, target=target, fmt=fmt)
                    self.assertEqual(result['processing_action'], 'transcoded')
                    for option in ['-b:v', '-minrate', '-maxrate']:
                        self.assertEqual(command[command.index(option)+1], str(round(target*1_000_000)))
                    self.assertEqual(command[command.index('-bufsize')+1], str(round(target*2_000_000)))

    def test_unknown_rate_and_incompatible_codec_convert(self):
        for changes in [dict(bitrate=None), dict(codec='hevc')]:
            result, command = self.scenario(**changes)
            self.assertEqual(result['processing_action'], 'transcoded')
            self.assertEqual(command[command.index('-c:v')+1], 'libx264')

    def test_non_faststart_and_incompatible_audio_preserve_video_stream(self):
        for changes in [dict(faststart=False), dict(audio_codec='ac3')]:
            result, command = self.scenario(**changes)
            self.assertEqual(result['processing_action'], 'remuxed_without_video_reencoding')
            self.assertEqual(command[command.index('-c:v')+1], 'copy')

    def test_invalid_targets_rejected_before_decoding(self):
        for value in [0, .99, 15.01, 'invalid', None, float('nan'), float('inf'), 3.001]:
            with patch.object(validate, 'probe') as probe:
                with self.assertRaises(validate.InvalidMedia): validate.video(Path('unused'), Path('unused'), value)
                probe.assert_not_called()

    def test_missing_bitrate_packet_probe_failure_falls_back_to_conversion(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'source';source.write_bytes(b'fixture')
            with patch.object(validate.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'ffprobe')):
                self.assertIsNone(validate.measured_bitrate(source, {'index':0}, 1))
            with patch.object(validate.subprocess, 'run') as run:
                self.assertEqual(validate.measured_bitrate(source, {'index':0, 'bit_rate':'32'}, 1), 32)
                run.assert_not_called()


class RealBitrateConversions(unittest.TestCase):
    def test_real_keep_convert_and_source_preservation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name, fmt, rate, faststart, target, expected in [
                ('low', 'mp4', '3800k', True, 1, 'kept_original'),
                ('audio-total', 'mp4', '4450k', True, 3, 'kept_original'),
                ('high', 'mp4', '6000k', True, 3, 'transcoded'),
                ('changed-target', 'mp4', '6000k', True, 4, 'transcoded'),
                ('mov', 'mov', '3000k', False, 3, 'transcoded'),
                ('tail-moov', 'mp4', '2000k', False, 3, 'remuxed_without_video_reencoding'),
            ]:
                source=root/(name+'.'+fmt);destination=root/name;destination.mkdir()
                command=['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=25',
                    '-f','lavfi','-i','anoisesrc=r=48000:a=0.5','-t','12' if name=='audio-total' else '3','-c:v','libx264','-pix_fmt','yuv420p',
                    '-b:v',rate,'-minrate',rate,'-maxrate',rate,'-bufsize',str(int(rate[:-1])*2)+'k',
                    '-x264-params','nal-hrd=vbr:filler=1','-threads','1','-c:a','aac','-b:a','512k']
                if faststart:command+=['-movflags','+faststart']
                subprocess.run(command+['-f',fmt,str(source)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                digest=hashlib.sha256(source.read_bytes()).digest()
                result=validate.video(source,destination,target)
                self.assertEqual(result['processing_action'],expected,name)
                self.assertEqual(hashlib.sha256(source.read_bytes()).digest(),digest)
                self.assertTrue((destination/'preview.webp').is_file())
                self.assertEqual(result['video_codec'],'h264');self.assertEqual(result['audio_codec'],'aac')
                self.assertTrue(validate.mp4_faststart(destination/'stream.mp4'))
                if expected=='kept_original':self.assertEqual(hashlib.sha256((destination/'stream.mp4').read_bytes()).digest(),digest)
                if name=='audio-total':
                    self.assertGreater(float(validate.probe(source)['format']['bit_rate']),4_500_000)
                    self.assertLessEqual(result['source_metadata']['video_bitrate'],4500)
                if expected=='transcoded':self.assertLess(abs(result['video_bitrate']/1000-target),target*.12)
                print('PASS real '+name+': '+expected,flush=True)


if __name__=='__main__': unittest.main(verbosity=2)
