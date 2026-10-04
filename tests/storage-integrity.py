import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import uuid

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('checker',ROOT/'scripts/check-database-integrity.py')
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)


class StorageAudit(unittest.TestCase):
    def test_read_only_missing_orphan_receipt_and_version_detection(self):
        owner=str(uuid.uuid4()); missing=str(uuid.uuid4()); version=str(uuid.uuid4())
        snapshot=dict(objects=[dict(id=missing,bucket='user-files',name=owner+'/missing.txt',version=version,size='1')],
            users=[owner],videos=[],photos=[],file_metadata=[],jobs=[],previews=[])
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)/'tenant';base.mkdir()
            orphan=base/'user-files'/owner/'interrupted.txt'/version;orphan.parent.mkdir(parents=True);orphan.write_bytes(b'fixture')
            receipt=orphan.with_name(version+'.json');receipt.write_text(json.dumps({'id':'tenant/'+str(orphan.relative_to(base))}))
            before={p.relative_to(base).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file()}
            found=checker.inspect_snapshot(snapshot,base)
            self.assertEqual({item['category'] for item in found},{'unreferenced_storage_object','catalog_without_physical_file','upload_receipt','physical_file_without_catalog'})
            self.assertEqual(before,{p.relative_to(base).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file()})

    def test_path_escape_is_reported_without_reading_outside_storage(self):
        snapshot=dict(objects=[dict(id='x',bucket='user-files',name='../../outside',version='',size='0')],
            users=[],videos=[],photos=[],file_metadata=[],jobs=[],previews=[])
        with tempfile.TemporaryDirectory() as temp:
            found=checker.inspect_snapshot(snapshot,temp)
        self.assertIn('unsafe_storage_path',[row['category'] for row in found])


if __name__=='__main__': unittest.main()
