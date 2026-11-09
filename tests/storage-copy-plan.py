import copy,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('copy_plan',Path(__file__).resolve().parents[1]/'scripts/plan-storage-copy.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
OWNER='11111111-1111-4111-8111-111111111111';FILE='22222222-2222-4222-8222-222222222222';OBJECT='33333333-3333-4333-8333-333333333333'
class CopyPlan(unittest.TestCase):
 def setUp(self):
  self.path=OWNER+'/Projects/name.txt'
  self.snapshot={'users':[OWNER],'objects':[{'bucket':'user-files','name':self.path,'id':OBJECT,'version':'v1','size':'25'}],
   'file_metadata':[{'owner_id':OWNER,'object_path':self.path,'source_id':None,'public_id':FILE,'is_folder':False}]}
  self.audited={'report':{'manifest':[{'old_bucket':'user-files','old_key':self.path,'object_id':OBJECT,'version':'v1','bytes':25,'exists':True,'sha256':'digest','owner':OWNER,'media_id':OBJECT,
   'proposed_location':f'users/{OWNER}/files/Projects/name.txt','references':[{'role':'file','owner_verified':True}]}]}}
 def result(self):return module.make_copy_plan(self.snapshot,self.audited)
 def test_files_keep_hierarchy_and_immutable_owner_and_database_identity(self):
  before=copy.deepcopy((self.snapshot,self.audited));r=self.result()
  self.assertEqual(r['objects'][0]['destination_key'],f'{OWNER}/files/Projects/name.txt')
  self.assertEqual(r['objects'][0]['resource_uuid'],FILE)
  self.assertFalse(r['application_cutover']);self.assertFalse(r['destination_public']);self.assertEqual(before,(self.snapshot,self.audited))
 def test_folder_markers_are_not_permanent_content(self):
  self.audited['report']['manifest'][0]['references'][0]['role']='folder_marker'
  self.assertEqual(self.result()['count'],0)
 def test_changed_source_and_wrong_owner_stop_plan(self):
  for change in [lambda:self.snapshot['objects'][0].update(version='v2'),lambda:self.snapshot['file_metadata'][0].update(owner_id=FILE),lambda:self.snapshot['file_metadata'][0].update(source_id=FILE)]:
   self.setUp();change()
   with self.assertRaises(ValueError):self.result()
if __name__=='__main__':unittest.main()
