import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import worker

OWNER='11111111-1111-4111-8111-111111111111'
class PublicationTests(unittest.TestCase):
    def scenario(self,kind='photo',invalid=False,fail_insert=False,fail_status=False,rejected=False):
        calls=[];removals=[];uploads=[]
        job=dict(id='55555555-5555-4555-8555-555555555555',owner_id=OWNER,kind=kind,file_name='fixture',visibility='private',has_preview=False,target_video_id='33333333-3333-4333-8333-333333333333')
        def api(method,path,**kwargs):
            calls.append((method,path,kwargs))
            if 'storage_settings' in path:return [{}]
            if 'profiles' in path:return [{'email':'fixture@example.test'}]
            if method=='POST' and rejected:raise worker.RejectedRequest('A photo with this name already exists.')
            if method=='POST' and fail_insert:raise ConnectionError('ambiguous database response')
            if method=='PATCH' and kwargs['json'].get('status')=='complete' and fail_status:raise ConnectionError('ambiguous status response')
        def validate(kind,source,directory):
            if invalid:raise ValueError('Not a decodable image.')
            return dict(extension='jpg',mime_type='image/jpeg',width=64,height=48,format='mov',duration_seconds=1)
        with tempfile.TemporaryDirectory() as tmp:
            real_temp=tempfile.TemporaryDirectory
            with patch.object(worker.tempfile,'TemporaryDirectory',side_effect=lambda **kw:real_temp(dir=tmp)),patch.object(worker,'api',side_effect=api),patch.object(worker,'download',return_value=64),patch.object(worker,'validate',side_effect=validate),patch.object(worker,'upload',side_effect=lambda bucket,path,source,mime,created:(uploads.append(path),created.append((bucket,path)))),patch.object(worker,'remove',side_effect=lambda bucket,paths:removals.append((bucket,paths))):
                worker.process(job)
        return calls,removals,uploads
    def test_invalid_never_published(self):
        calls,removed,uploaded=self.scenario(invalid=True)
        self.assertFalse(uploaded);self.assertFalse(any(method=='POST' for method,_,_ in calls))
        self.assertEqual([bucket for bucket,_ in removed],['media-staging'])
        self.assertTrue(any(kw['json'].get('status')=='error' for method,_,kw in calls if method=='PATCH'))
    def test_photo_published_after_validation(self):
        calls,removed,uploaded=self.scenario()
        self.assertEqual(len(uploaded),3)
        self.assertTrue(any(method=='POST' and path=='/rest/v1/photos' for method,path,_ in calls))
        self.assertEqual([bucket for bucket,_ in removed],['media-staging'])
    def test_video_has_processed_path(self):
        calls,_,_=self.scenario(kind='video')
        record=next(kw['json'] for method,path,kw in calls if method=='POST' and path=='/rest/v1/videos')
        self.assertEqual(record['processing_status'],'ready');self.assertTrue(record['processed_storage_path'].endswith('/stream.mp4'))
    def test_ambiguous_commit_never_deletes_final_media(self):
        for mode in ['fail_insert','fail_status']:
            _,removed,uploaded=self.scenario(**{mode:True})
            self.assertTrue(uploaded);self.assertEqual([bucket for bucket,_ in removed],['media-staging'])
    def test_confirmed_rejection_cleans_only_new_uploads(self):
        calls,removed,uploaded=self.scenario(rejected=True)
        self.assertEqual(len(uploaded),3)
        self.assertEqual(len([bucket for bucket,_ in removed if bucket=='user-images']),3)
        self.assertTrue(any(kw['json'].get('error')=='A photo with this name already exists.' for method,_,kw in calls if method=='PATCH'))
    def test_preview_only_returns_validated_path(self):
        calls,_,uploaded=self.scenario(kind='preview')
        self.assertEqual(len(uploaded),1);self.assertFalse(any(method=='POST' for method,_,_ in calls))
        result=next(kw['json']['result'] for method,_,kw in calls if method=='PATCH' and kw['json'].get('status')=='complete')
        self.assertTrue(result['path'].endswith('.webp'))
if __name__=='__main__':unittest.main()
