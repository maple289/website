import copy
import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('cleanup_plan',Path(__file__).resolve().parents[1]/'scripts/plan-original-video-cleanup.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
OWNER='11111111-1111-4111-8111-111111111111'
VIDEO='22222222-2222-4222-8222-222222222222'

class CleanupPlanTests(unittest.TestCase):
    def setUp(self):
        self.source=f'{OWNER}/videos/{VIDEO}/original.mov';self.final=f'{OWNER}/videos/{VIDEO}/stream.mp4'
        self.snapshot={'users':[OWNER],'storage_settings':{},'videos':[{'id':VIDEO,'owner_id':OWNER,'storage_path':self.source,'processed_storage_path':self.final,'processing_status':'ready'}],'jobs':[]}
        self.audit={'report':{'manifest':[]}};self.backup={}
        for path,size in [(self.source,100),(self.final,20)]:
            row={'old_bucket':'user-videos','old_key':path,'physical_relative':'user-videos/'+path+'/version','bytes':size,'catalog_size':str(size),'sha256':path,'exists':True,'owner':OWNER,'media_id':VIDEO,'probe':{'valid':True,'duration':10,'codec':'h264'}}
            self.audit['report']['manifest'].append(row)
            self.backup['storage/stub/stub/'+row['physical_relative']]={'size':size,'sha256':path}
        self.references={self.source:[{'table':'videos','rows':1}]}
    def result(self):
        return module.plan(self.snapshot,self.audit,self.references,self.backup)
    def test_verified_candidate_and_no_mutation(self):
        before=copy.deepcopy((self.snapshot,self.audit,self.backup))
        r=self.result();self.assertEqual(r['potential_recovery_bytes'],100);self.assertEqual(r['rows'][0]['decision'],'DELETE CANDIDATE')
        self.assertEqual(before,(self.snapshot,self.audit,self.backup))
    def test_sole_final_is_kept(self):
        self.snapshot['videos'][0]['storage_path']=self.final
        self.assertEqual(self.result()['rows'][0]['decision'],'KEEP')
    def test_each_uncertainty_retains_source(self):
        mutations=[lambda:self.snapshot['jobs'].append({'id':VIDEO,'status':'error'}),
                   lambda:self.backup.clear(),lambda:self.references[self.source].append({'table':'other','rows':1}),
                   lambda:self.audit['report']['manifest'][1].update(bytes=0),
                   lambda:self.audit['report']['manifest'][1].update(probe={'valid':True,'duration':float('inf'),'codec':'h264'}),
                   lambda:self.audit['report']['manifest'][0].update(owner='another-owner'),
                   lambda:self.snapshot['videos'][0].update(processing_status='processing')]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.setUp();mutate();self.assertEqual(self.result()['potential_recovery_bytes'],0)
                self.assertEqual(self.result()['rows'][0]['decision'],'REVIEW')

if __name__=='__main__':unittest.main()
