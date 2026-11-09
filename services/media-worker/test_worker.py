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

    def scenario(self,kind='photo',invalid=False,fail_insert=False,fail_status=False,rejected=False,cancelled=False,decoder_error=None,target=3,unconfirmed_success=False,layout=1,staging='media-staging'):
        calls=[];removals=[];uploads=[]
        committed=False
        job=dict(id='55555555-5555-4555-8555-555555555555',owner_id=OWNER,kind=kind,file_name='fixture',visibility='private',has_preview=False,target_video_id='33333333-3333-4333-8333-333333333333')
        job.update(output_layout=layout,input_bucket=staging,input_prefix=('uploads/' if staging=='staging' else '')+OWNER+'/'+job['id'])
        def api(method,path,**kwargs):
            nonlocal committed
            calls.append((method,path,kwargs))
            if 'storage_settings' in path:return [{'target_video_bitrate_mbps':target}]
            if method=='GET' and 'media_upload_jobs' in path:return [{'status':'cancelling' if cancelled else 'complete' if committed else 'processing'}]
            if 'profiles' in path:return [{'email':'fixture@example.test'}]
            if method=='POST' and rejected:raise worker.RejectedRequest('A photo with this name already exists.')
            if method=='POST' and fail_insert:raise ConnectionError('ambiguous database response')
            if method=='POST' and path.endswith('publish_media_upload'):
                result=dict(kwargs['json']['p_record']) if kind=='preview' else {'id':job['id']}
                if unconfirmed_success:return result
                committed=True
                if fail_status:raise ConnectionError('ambiguous status response')
                return result
        def validate(kind,source,directory,job_id=None,claim_token=None,target_video_bitrate_mbps=None):
            if kind == 'video': self.assertEqual(target_video_bitrate_mbps, target)
            if decoder_error: raise decoder_error
            if invalid:raise ValueError('Not a decodable image.')
            (directory/'stream.mp4').write_bytes(b'fixture')
            return dict(video_codec='h264',video_bitrate=2500.125,frame_rate=25,source_metadata={'container':'mov'},processing_action='transcoded',audio_codec=None,audio_bitrate=None,extension='jpg',mime_type='image/jpeg',width=64,height=48,format='mp4',duration_seconds=1)
        def download(path,destination,maximum,bucket='media-staging'):
            calls.append(('DOWNLOAD',path,{'bucket':bucket}));return 64
        with tempfile.TemporaryDirectory() as tmp:
            real_temp=tempfile.TemporaryDirectory
            with patch.object(worker.tempfile,'TemporaryDirectory',side_effect=lambda **kw:real_temp(dir=tmp)),patch.object(worker,'api',side_effect=api),patch.object(worker,'download',side_effect=download),patch.object(worker,'validate',side_effect=validate),patch.object(worker,'upload',side_effect=lambda bucket,path,source,mime,created:(uploads.append(path),created.append((bucket,path)))),patch.object(worker,'remove',side_effect=lambda bucket,paths:removals.append((bucket,paths))):
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
        calls,_,uploaded=self.scenario(kind='video')
        record=next(kw['json']['p_record'] for method,path,kw in calls if method=='POST' and path.endswith('publish_media_upload'))
        self.assertIsInstance(record['video_bitrate'],int)
        self.assertEqual(record['video_bitrate'],2500)
        self.assertEqual(record['processing_status'],'ready');self.assertTrue(record['processed_storage_path'].endswith('/video.mp4'))
        self.assertEqual(record['storage_path'],record['processed_storage_path'])
        self.assertEqual(record['mime_type'],'video/mp4')
        self.assertEqual(len(uploaded),2,'Only one final MP4 and one thumbnail are permanent')
        self.assertFalse(any('/original.' in path for path in uploaded))

    def test_unconfirmed_video_publication_retains_staging_and_final_for_recovery(self):
        _,removed,uploaded=self.scenario(kind='video',fail_insert=True)
        self.assertEqual(len(uploaded),2)
        self.assertFalse(removed,'Ambiguous publication cannot prove source cleanup is safe')

    def test_success_response_without_completed_job_never_deletes_source(self):
        _,removed,uploaded=self.scenario(kind='video',unconfirmed_success=True)
        self.assertEqual(len(uploaded),2)
        self.assertFalse(removed,'HTTP success alone does not confirm Ready publication')

    def test_finalized_source_cleanup_only_accepts_exact_staging_keys(self):
        valid=OWNER+'/55555555-5555-4555-8555-555555555555/source'
        candidates=[{'bucket_id':'media-staging','name':valid},
                    {'bucket_id':'user-videos','name':valid},
                    {'bucket_id':'media-staging','name':OWNER+'/../source'},
                    {'bucket_id':'media-staging','name':None},
                    {'bucket_id':'media-staging','name':valid+'/extra'},
                    {'bucket_id':'media-staging','name':valid.replace('/source','/saved.mp4')}]
        with patch.object(worker,'api',return_value=candidates),patch.object(worker,'remove') as remove:
            worker.cleanup_finalized_video_sources()
        remove.assert_called_once_with('media-staging',[valid])
    def test_each_video_job_uses_current_setting(self):
        for target in [2.5,3,3.5,4,4.5,15]:
            calls,_,_=self.scenario(kind='video',target=target)
            self.assertTrue(any('select=target_video_bitrate_mbps' in path for _,path,_ in calls))
    def test_new_layout_video_and_photo_keep_related_outputs_together(self):
        for kind,files in [('video',['video.mp4','thumbnail.webp']),('photo',['photo.jpg','preview.webp','thumbnail.webp'])]:
            calls,removed,uploaded=self.scenario(kind=kind,layout=2,staging='staging')
            base=OWNER+'/'+('videos' if kind=='video' else 'photos')+'/55555555-5555-4555-8555-555555555555/'
            self.assertEqual(uploaded,[base+name for name in files])
            record=next(kw['json']['p_record'] for method,path,kw in calls if path.endswith('publish_media_upload'))
            self.assertEqual(record['storage_bucket'],'users')
            if kind=='video': self.assertEqual(record['preview_bucket'],'users')
            self.assertTrue(any(method=='DOWNLOAD' and kw['bucket']=='staging' and path.startswith('uploads/'+OWNER+'/') for method,path,kw in calls))
            self.assertEqual([bucket for bucket,_ in removed],['staging'])
    def test_new_layout_preview_uses_target_video_directory(self):
        calls,_,uploaded=self.scenario(kind='preview',layout=2,staging='staging')
        record=next(kw['json']['p_record'] for method,path,kw in calls if path.endswith('publish_media_upload'))
        self.assertEqual(record['bucket'],'users')
        self.assertEqual(uploaded,[OWNER+'/videos/33333333-3333-4333-8333-333333333333/55555555-5555-4555-8555-555555555555.webp'])
    def test_new_layout_failure_retains_exact_staging_source(self):
        _,removed,_=self.scenario(kind='video',layout=2,staging='staging',decoder_error=ValueError('invalid'))
        self.assertFalse(removed)
    def test_staging_contract_rejects_wrong_owner_bucket_path_and_layout(self):
        job=dict(id='55555555-5555-4555-8555-555555555555',owner_id=OWNER,kind='video')
        self.assertEqual(worker.job_storage_location(job),('media-staging',OWNER+'/'+job['id'],1))
        for patch in [{'input_prefix':'other/'+job['id']},{'input_bucket':'users'},{'output_layout':3},{'output_layout':True},{'owner_id':'../other'}]:
            with self.assertRaises(ValueError):worker.job_storage_location({**job,**patch})
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
