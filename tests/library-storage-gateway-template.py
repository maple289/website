import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('gateway',Path(__file__).resolve().parents[1]/'scripts/prepare-library-storage-gateway.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class GatewayTemplate(unittest.TestCase):
 def setUp(self):
  self.prefix='_format_version: "3.0"\nservices:\n  - name: storage\n    url: http://storage:5000\n  - name: functions\n    url: http://functions:9000\n'
  self.suffix='consumers:\n  - username: synthetic\n    keyauth_credentials:\n      - key: fixture-secret-placeholder\n'
  self.fragment=Path('deploy/library-storage-signing.kong.yml').read_text()
 def test_only_the_reviewed_service_is_added_and_original_bytes_survive(self):
  original=self.prefix+self.suffix;updated=module.prepare(original,self.fragment)
  self.assertTrue(updated.startswith(self.prefix));self.assertTrue(updated.endswith(self.suffix))
  self.assertEqual(module.prepare(updated,self.fragment),updated)
  self.assertEqual(updated.splitlines().count('  - name: library-storage-signing'),1)
 def test_conflicts_and_unexpected_structures_require_review(self):
  for current in ['services: []\n','services:\n- name: storage\n',self.prefix+'services:\n',self.prefix+'  - name: library-storage-signing\n']:
   with self.subTest(current=current),self.assertRaises(ValueError):module.prepare(current,self.fragment)
  installed=module.prepare(self.prefix+self.suffix,self.fragment)
  with self.assertRaises(ValueError):module.prepare(installed,self.fragment.replace('regex_priority: 100','regex_priority: 200'))
 def test_legacy_document_keeps_its_version_and_uses_legacy_regex(self):
  for version in ['1.1','2.1']:
   original=(self.prefix+self.suffix).replace('"3.0"',"'"+version+"'")
   updated=module.prepare(original,self.fragment)
   self.assertTrue(updated.startswith(original.split('consumers:')[0]))
   self.assertTrue(updated.endswith(self.suffix))
   self.assertIn("- '/storage/v1/(?<library_operation>",updated)
   self.assertNotIn("- '~/storage/v1/",updated)
   self.assertEqual(module.prepare(updated,self.fragment),updated)
if __name__=='__main__':unittest.main()
