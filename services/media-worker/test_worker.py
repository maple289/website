import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import worker

OWNER='11111111-1111-4111-8111-111111111111'
class PublicationTests(unittest.TestCase):
    def test_cancellation_terminates_decoder_process_group(self):
        process=MagicMock(pid=321)
        process.communicate.side_effect=[worker.subprocess.TimeoutExpired('validator',2),(b'',b'')]
        with patch.object(worker.subprocess,'Popen',return_value=process), \
             patch.object(worker,'check_cancelled',side_effect=[None,worker.CancelledUpload('cancel')]), \
             patch.object(worker.os,'killpg') as kill:
            with self.assertRaises(worker.CancelledUpload):
                worker.validate('video',Path('/tmp/source'),Path('/tmp/output'),'test-job')
            kill.assert_called_once_with(321,worker.signal.SIGKILL)
            self.assertEqual(process.communicate.call_count,2)

    def scenario(self,kind='photo',invalid=False,fail_insert=False,fail_status=False,rejected=False,cancelled=False,decoder_error=None):
        calls=[];removals=[];uploads=[]
        committed=False
        job=dict(id='55555555-5555-4555-8555-555555555555',owner_id=OWNER,kind=kind,file_name='fixture',visibility='private',has_preview=False,target_video_id='33333333-3333-4333-8333-333333333333')
        def api(method,path,**kwargs):
            nonlocal committed
            calls.append((method,path,kwargs))
            if 'storage_settings' in path:return [{}]
            if method=='GET' and 'media_upload_jobs' in path:return [{'status':'cancelling' if cancelled else 'complete' if committed else 'processing'}]
            if 'profiles' in path:return [{'email':'fixture@example.test'}]
            if method=='POST' and rejected:raise worker.RejectedRequest('A photo with this name already exists.')
            if method=='POST' and fail_insert:raise ConnectionError('ambiguous database response')
            if method=='POST' and path.endswith('publish_media_upload'):
                committed=True
                if fail_status:raise ConnectionError('ambiguous status response')
        def validate(kind,source,directory,job_id=None,claim_token=None):
            if decoder_error: raise decoder_error
            if invalid:raise ValueError('Not a decodable image.')
            (directory/'stream.mp4').write_bytes(b'fixture')
            return dict(video_codec='h264',video_bitrate=2500.125,frame_rate=25,source_metadata={},processing_action='transcoded',audio_codec=None,audio_bitrate=None,extension='jpg',mime_type='image/jpeg',width=64,height=48,format='mov',duration_seconds=1)
        with tempfile.TemporaryDirectory() as tmp:
            real_temp=tempfile.TemporaryDirectory
            with patch.object(worker.tempfile,'TemporaryDirectory',side_effect=lambda **kw:real_temp(dir=tmp)),patch.object(worker,'api',side_effect=api),patch.object(worker,'download',return_value=64),patch.object(worker,'validate',side_effect=validate),patch.object(worker,'upload',side_effect=lambda bucket,path,source,mime,created:(uploads.append(path),created.append((bucket,path)))),patch.object(worker,'remove',side_effect=lambda bucket,paths:removals.append((bucket,paths))):
                worker.process(job)
        return calls,removals,uploads
    def test_cancelled_never_published_and_acknowledged(self):
        calls,removed,uploaded=self.scenario(kind='video',cancelled=True)
        self.assertFalse(uploaded)
        self.assertFalse(any(method=='POST' for method,_,_ in calls))
        self.assertTrue(any(kw['json'].get('status')=='cancelled' for method,_,kw in calls if method=='PATCH'))
        self.assertIn('media-staging',[bucket for bucket,_ in removed])

    def test_invalid_never_published(self):
        calls,removed,uploaded=self.scenario(invalid=True)
        self.assertFalse(uploaded);self.assertFalse(any(method=='POST' for method,_,_ in calls))
        self.assertEqual([bucket for bucket,_ in removed],['media-staging'])
        self.assertTrue(any(kw['json'].get('status')=='error' for method,_,kw in calls if method=='PATCH'))
    def test_photo_published_after_validation(self):
        calls,removed,uploaded=self.scenario()
        self.assertEqual(len(uploaded),3)
        self.assertTrue(any(method=='POST' and path.endswith('publish_media_upload') for method,path,_ in calls))
        self.assertEqual([bucket for bucket,_ in removed],['media-staging'])
    def test_video_has_processed_path(self):
        calls,_,_=self.scenario(kind='video')
        record=next(kw['json']['p_record'] for method,path,kw in calls if method=='POST' and path.endswith('publish_media_upload'))
        self.assertIsInstance(record['video_bitrate'],int)
        self.assertEqual(record['video_bitrate'],2500)
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
        self.assertEqual(len(uploaded),1)
        result=next(kw['json']['p_record'] for method,path,kw in calls if path.endswith('publish_media_upload'))
        self.assertTrue(result['path'].endswith('.webp'))

    def test_disk_full_and_missing_source_never_publish(self):
        for cause in [OSError(28,'No space left on device'),FileNotFoundError('fixture source'),PermissionError('fixture output')]:
            calls,removed,uploaded=self.scenario(kind='video',decoder_error=cause)
            self.assertFalse(uploaded)
            self.assertFalse(any(path.endswith('publish_media_upload') for _,path,_ in calls))
            self.assertFalse(any(bucket=='media-staging' for bucket,_ in removed))
            self.assertTrue(any(kw['json'].get('status')=='error' for method,_,kw in calls if method=='PATCH'))

    def test_lost_claim_is_rejected_before_publication(self):
        with patch.object(worker,'api',return_value=[{'status':'processing','claim_token':'new'}]):
            with self.assertRaises(worker.LostClaim): worker.check_cancelled('fixture','old')

    def test_ambiguous_storage_upload_tracked_but_conflict_not_deleted(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'new';source.write_bytes(b'fixture')
            created=[]
            with patch.object(worker,'api',side_effect=ConnectionError('lost response')):
                with self.assertRaises(ConnectionError): worker.upload('bucket','unique-job-path',source,'video/mp4',created)
            self.assertEqual(created,[('bucket','unique-job-path')])
            created=[]
            with patch.object(worker,'api',side_effect=worker.RejectedRequest('exists')):
                with self.assertRaises(worker.RejectedRequest): worker.upload('bucket','existing-path',source,'video/mp4',created)
            self.assertEqual(created,[])

    def test_error_update_cannot_overwrite_committed_complete(self):
        with patch.object(worker,'api') as api:
            worker.job_update('fixture','claim',expected_status='processing',status='error')
        self.assertIn('&status=eq.processing',api.call_args.args[1])
        self.assertIn('&claim_token=eq.claim',api.call_args.args[1])

    def test_startup_cleanup_skips_active_and_untagged_work(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            old=root/'media-old';old.mkdir();(old/'.worker-lock').touch()
            untagged=root/'media-legacy';untagged.mkdir()
            active=root/'media-active';active.mkdir()
            with (active/'.worker-lock').open('w') as lock:
                worker.fcntl.flock(lock,worker.fcntl.LOCK_EX)
                worker.cleanup_scratch(root)
                self.assertTrue(active.exists())
                self.assertFalse(old.exists())
                self.assertTrue(untagged.exists())
if __name__=='__main__':unittest.main()
