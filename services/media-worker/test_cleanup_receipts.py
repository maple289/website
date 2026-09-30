import json
import pathlib
import tempfile
import unittest
import uuid
from cleanup_receipts import clean_receipts


class ReceiptCleanupTests(unittest.TestCase):
    def test_only_confirmed_missing_payload_receipts(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary) / 'tenant'
            owner, job, unrelated = [str(uuid.uuid4()) for _ in range(3)]
            def receipt(jid, kind='source', payload=False, valid=True):
                target = base / 'media-staging' / owner / jid / kind / str(uuid.uuid4())
                target.parent.mkdir(parents=True, exist_ok=True)
                path = target.with_suffix('.json')
                path.write_text(json.dumps({'id': 'tenant/' + str(target.relative_to(base)) if valid else 'other'}))
                if payload:
                    target.write_bytes(b'saved content')
                return path
            removed = receipt(job)
            preview = receipt(job, 'preview')
            saved = receipt(job, payload=True)
            wrong = receipt(job, valid=False)
            other = receipt(unrelated)
            self.assertEqual(clean_receipts(base, [{'owner': owner, 'ids': [job]}]), 2)
            self.assertFalse(removed.exists())
            self.assertFalse(preview.exists())
            for path in (saved, wrong, other):
                self.assertTrue(path.exists())
            self.assertEqual(saved.with_suffix('').read_bytes(), b'saved content')
            self.assertEqual(clean_receipts(base, [{'owner': owner, 'ids': [job]}]), 0)

    def test_reject_non_uuid_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(ValueError):
                clean_receipts(temporary, [{'owner': '../escape', 'ids': []}])


if __name__ == '__main__':
    unittest.main()
