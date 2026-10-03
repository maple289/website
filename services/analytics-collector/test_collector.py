import importlib.util,os,pathlib,tempfile,unittest,sys
from unittest.mock import patch,Mock
os.environ.update(SUPABASE_URL='http://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY='fixture-only',GLOBAL_S3_BUCKET='bucket',TENANT_ID='tenant')
sys.modules['requests']=Mock() # All RPC calls are mocked; no network in these tests.
spec=importlib.util.spec_from_file_location('collector',pathlib.Path(__file__).with_name('collector.py'))
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
class CollectorTests(unittest.TestCase):
 def test_periodic_inventory(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);storage=root/'mount'/'bucket'/'tenant';scratch=root/'scratch';scratch.mkdir()
   values=[('user-videos','videos/owner/movie.mp4','Videos',101,'owner'),('user-files','owner/Report.pdf','Files',29,'owner'),('file-previews','owner/cached.pdf','Preview cache',41,'owner')]
   rows=[]
   for i,(bucket,name,category,size,owner) in enumerate(values):
    dest=storage/bucket/name/'version';dest.parent.mkdir(parents=True);dest.write_bytes(b'x'*size)
    rows.append(dict(id=str(i),bucket_id=bucket,name=name,category=category,owner_id=owner))
   (scratch/'processing.tmp').write_bytes(b'x'*17)
   saved={}
   def rpc(name,body):
    if name=='analytics_inventory':return rows
    if name=='analytics_database_bytes':return 59
    if name=='analytics_store_snapshot':saved.update(body['p_data']);return
    raise AssertionError(name)
   with patch.object(collector,'rpc',rpc):collector.collect(root/'mount',scratch,root/'heartbeat')
   self.assertEqual({i['label']:i['value'] for i in saved['categories']},{'Videos':101,'Photos':0,'Files':29,'Preview cache':41,'Temporary / processing':17,'Other application data':59})
   self.assertEqual(saved['users'],[dict(id='owner',value=130)])
   self.assertEqual(len(saved['disks']),1)
   self.assertEqual(saved['errors'],[])
   self.assertTrue((root/'heartbeat').exists())
 def test_disappearing_entries_not_reported_as_permission_failure(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'bucket'/'tenant').mkdir(parents=True);scratch=root/'scratch';scratch.mkdir();saved={}
   def rpc(name,body):
    if name=='analytics_inventory':return []
    if name=='analytics_database_bytes':return 0
    if name=='analytics_store_snapshot':saved.update(body['p_data'])
   def walk(location,followlinks,onerror):
    onerror(FileNotFoundError('removed concurrently'))
    yield str(location),[],['removed.tmp']
   with patch.object(collector,'rpc',rpc),patch.object(collector.os,'walk',walk):collector.collect(root,scratch,root/'heartbeat')
   self.assertEqual(saved['errors'],[])
 def test_unreadable_entries_reported(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'bucket'/'tenant').mkdir(parents=True);scratch=root/'scratch';scratch.mkdir();saved={}
   def rpc(name,body):
    if name=='analytics_inventory':return []
    if name=='analytics_database_bytes':return 0
    if name=='analytics_store_snapshot':saved.update(body['p_data'])
   def walk(location,followlinks,onerror):
    onerror(PermissionError('unreadable'))
    return iter([])
   with patch.object(collector,'rpc',rpc),patch.object(collector.os,'walk',walk):collector.collect(root,scratch,root/'heartbeat')
   self.assertEqual(len(saved['errors']),2)
 def test_keyset_pages(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'bucket'/'tenant').mkdir(parents=True);scratch=root/'scratch';scratch.mkdir();cursors=[]
   def rpc(name,body):
    if name=='analytics_inventory':
     cursors.append(body['p_after'])
     return [dict(id=str(i),bucket_id='user-files',name=str(i),category='Files',owner_id=None) for i in range(1000)] if body['p_after'] is None else []
    if name=='analytics_database_bytes':return 0
   with patch.object(collector,'rpc',rpc):collector.collect(root,scratch,root/'heartbeat')
   self.assertEqual(cursors,[None,'999'])
 def test_invalid_roots_rejected(self):
  with patch.object(collector,'rpc',lambda *args:[]),patch.dict(os.environ,GLOBAL_S3_BUCKET='../outside'):
   with self.assertRaises(ValueError):collector.collect()
unittest.main()
