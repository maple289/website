"""Safety regressions for the read-only storage audit; no production fixtures."""
import importlib.util
import json
from contextlib import contextmanager
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('storage_audit', Path(__file__).resolve().parents[1] / 'scripts/audit-storage-layout.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
OWNER = '11111111-1111-4111-8111-111111111111'
VIDEO = '22222222-2222-4222-8222-222222222222'
OTHER = '33333333-3333-4333-8333-333333333333'
OBJECT = '44444444-4444-4444-8444-444444444444'
VERSION = '55555555-5555-4555-8555-555555555555'


@contextmanager
def workspace_fixture():
    workspace = Path(__file__).resolve().parents[1]
    root = workspace / '.runtime/storage-layout-audit-tests'
    root.mkdir(parents=True, exist_ok=True)
    if not root.resolve().is_relative_to(workspace):
        raise ValueError('Fixture root must stay inside the workspace')
    folder = Path(tempfile.mkdtemp(dir=root)).resolve()
    if not folder.is_relative_to(root.resolve()):
        raise ValueError('Unexpected fixture path; no cleanup attempted')
    try:
        yield folder
    finally:
        if not folder.resolve().is_relative_to(root.resolve()) or folder == root.resolve():
            raise ValueError('Unsafe fixture cleanup target')
        shutil.rmtree(folder)


def fixture(base, source='original.mov'):
    root = OWNER + '/videos/' + VIDEO + '/'
    final = root + 'stream.mp4'
    paths = list(dict.fromkeys([root + source, final]))
    objects = []
    for index, path in enumerate(paths):
        payload = base / 'user-videos' / path / VERSION
        payload.parent.mkdir(parents=True)
        payload.write_bytes(b'private-media-bytes')
        objects.append({'id': str(index), 'bucket': 'user-videos', 'name': path, 'version': VERSION, 'size': 19})
    return {'users': [OWNER], 'objects': objects, 'storage_settings': {}, 'photos': [], 'jobs': [], 'file_metadata': [],
        'videos': [{'id': VIDEO, 'owner_id': OWNER, 'storage_path': root + source,
            'processed_storage_path': final, 'processing_status': 'ready'}]}


class AuditSafety(unittest.TestCase):
    def test_distinct_original_never_deleted_or_given_a_permanent_destination(self):
        with workspace_fixture() as temporary:
            base = Path(temporary)
            snapshot = fixture(base)
            before = {str(p): audit.checksum(p) for p in base.rglob('*') if p.is_file()}
            report, _ = audit.make_manifest(snapshot, base, hashes=True)
            self.assertEqual(report['originals'][0]['decision'], 'REVIEW')
            source = next(r for r in report['manifest'] if r['old_key'].endswith('original.mov'))
            self.assertIsNone(source['proposed_location'])
            self.assertEqual(before, {str(p): audit.checksum(p) for p in base.rglob('*') if p.is_file()})

    def test_original_mp4_that_is_the_final_is_kept_once(self):
        with workspace_fixture() as temporary:
            snapshot = fixture(Path(temporary), source='stream.mp4')
            report, _ = audit.make_manifest(snapshot, temporary)
            self.assertEqual(report['originals'][0]['decision'], 'KEEP')
            self.assertEqual(len(report['manifest']), 1)
            self.assertEqual(report['manifest'][0]['proposed_location'], f'users/{OWNER}/videos/{VIDEO}/video.mp4')

    def test_wrong_media_uuid_and_storage_owner_are_not_reassigned(self):
        with workspace_fixture() as temporary:
            snapshot = fixture(Path(temporary))
            snapshot['videos'][0]['id'] = OTHER
            report, _ = audit.make_manifest(snapshot)
            self.assertTrue(all(r['proposed_location'] is None for r in report['manifest']))
            snapshot = fixture(Path(temporary) / 'second')
            snapshot['objects'][1]['owner'] = OTHER
            report, _ = audit.make_manifest(snapshot)
            self.assertIsNone(report['manifest'][1]['proposed_location'])

    def test_legacy_compact_uuid_must_match_database_media(self):
        with workspace_fixture() as temporary:
            snapshot = fixture(Path(temporary))
            for obj in snapshot['objects']:
                obj['name']=obj['name'].replace(VIDEO,OTHER.replace('-',''))
            for field in ['storage_path','processed_storage_path']:
                snapshot['videos'][0][field]=snapshot['videos'][0][field].replace(VIDEO,OTHER.replace('-',''))
            report,_=audit.make_manifest(snapshot)
            self.assertTrue(all(r['proposed_location'] is None for r in report['manifest']))

    def test_ambiguous_prefix_and_destination_collision_stop_mapping(self):
        with workspace_fixture() as temporary:
            snapshot = fixture(Path(temporary))
            obj = snapshot['objects'][1]
            snapshot['objects'].append({**obj, 'name': 'legacy/' + obj['name'], 'id': OBJECT})
            snapshot['storage_settings']['videos_base_path'] = 'legacy'
            report, _ = audit.make_manifest(snapshot)
            self.assertTrue(report['unresolved_references'])
            self.assertTrue(all(r['proposed_location'] is None for r in report['manifest']))

    def test_invalid_video_and_non_mp4_fallback_are_not_renamed_to_mp4(self):
        with workspace_fixture() as temporary:
            snapshot = fixture(Path(temporary))
            with patch.object(audit, 'probe_video', return_value={'valid': False}):
                report, _ = audit.make_manifest(snapshot, temporary, probes=True)
            self.assertIsNone(report['manifest'][1]['proposed_location'])
            snapshot['videos'][0]['processed_storage_path'] = None
            report, _ = audit.make_manifest(snapshot)
            self.assertTrue(all(r['proposed_location'] is None for r in report['manifest']))

    def test_probe_requires_mp4_video_and_finite_positive_duration(self):
        for duration, streams, container, expected in [
            ('3.0', [{'codec_type': 'video', 'codec_name': 'h264'}], 'mov,mp4,m4a,3gp,3g2,mj2', True),
            ('NaN', [{'codec_type': 'video'}], 'mp4', False),
            ('0', [{'codec_type': 'video'}], 'mp4', False),
            ('3.0', [], 'mp4', False),
            ('3.0', [{'codec_type': 'video'}], 'matroska', False),
        ]:
            response = SimpleNamespace(returncode=0, stdout=json.dumps({'streams': streams,
                'format': {'duration': duration, 'format_name': container}}))
            with patch.object(audit.subprocess, 'run', return_value=response):
                self.assertEqual(audit.probe_video(Path('fixture.mp4'))['valid'], expected)

    def test_traversal_and_source_id_mismatch_stop_mapping(self):
        with workspace_fixture() as temporary:
            with self.assertRaises(ValueError):
                audit.local_file(Path(temporary), '../outside')
            snapshot = {'users': [OWNER], 'objects': [{'id': OBJECT, 'bucket': 'user-files', 'name': OWNER + '/file.txt', 'version': VERSION}],
                'file_metadata': [{'owner_id': OWNER, 'source_id': OTHER, 'object_path': OWNER + '/file.txt'}]}
            report, _ = audit.make_manifest(snapshot)
            self.assertIsNone(report['manifest'][0]['proposed_location'])

    def test_age_and_completed_offset_do_not_establish_tus_expiry(self):
        with workspace_fixture() as temporary:
            base = Path(temporary)
            receipt = base / 'receipt.json'
            data = {'metadata': {'bucketName': 'media-staging', 'objectName': OWNER + '/' + VIDEO + '/source'},
                'size': 500, 'offset': 500, 'creation_date': '2000-01-01T00:00:00Z'}
            receipt.write_text(json.dumps(data))
            (base / 'unknown.json').write_text('{"application_setting":true}')
            report = audit.inspect_files(base, {'jobs': []}, {})
            self.assertTrue(all(r['type'] == 'D' and r['decision'] == 'KEEP' for r in report['json']))
            active = audit.inspect_files(base, {'jobs': [{'id': VIDEO, 'owner_id': OWNER, 'status': 'processing'}]}, {})
            self.assertEqual(next(r for r in active['json'] if r['path'] == 'receipt.json')['type'], 'A')
            self.assertTrue(receipt.exists())

    def test_cli_refuses_public_output_and_preserves_prior_reports_and_payloads(self):
        with workspace_fixture() as temporary:
            root = Path(temporary)
            base = root / 'storage'
            snapshot = fixture(base)
            saved = root / 'snapshot.json'
            saved.write_text(json.dumps(snapshot))
            script = Path(audit.__file__).resolve()
            common = [sys.executable, str(script), '--snapshot', str(saved), '--storage-base', str(base)]
            before = {str(p): audit.checksum(p) for p in base.rglob('*') if p.is_file()}
            public = subprocess.run([*common, '--output', str(base / 'reports')], capture_output=True, text=True)
            self.assertEqual(public.returncode, 2)
            self.assertFalse((base / 'reports').exists())
            output = root / 'private-report'
            result = subprocess.run([*common, '--output', str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads((output / 'summary.json').read_text())
            self.assertEqual(summary['space_recovered_bytes'], 0)
            self.assertEqual(summary['originals_removed'], 0)
            self.assertEqual(summary['json_removed'], 0)
            report_before = (output / 'manifest.json').read_bytes()
            repeat = subprocess.run([*common, '--output', str(output)], capture_output=True, text=True)
            self.assertEqual(repeat.returncode, 2)
            self.assertEqual((output / 'manifest.json').read_bytes(), report_before)
            self.assertEqual(before, {str(p): audit.checksum(p) for p in base.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
