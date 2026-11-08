import unittest
from unittest.mock import patch
import worker


class AmbiguousPublication(unittest.TestCase):
    job = {'id': 'fixture', 'preview_path': 'fixture.pdf'}

    def test_committed_ready_cache_is_not_removed(self):
        with patch.object(worker, 'api', return_value=[{'status': 'ready'}]), \
             patch.object(worker, 'source_current', return_value=True), \
             patch.object(worker, 'remove_cache') as remove:
            self.assertTrue(worker.recover_uploaded_preview(self.job))
            remove.assert_not_called()

    def test_unavailable_database_retains_cache_for_reconciliation(self):
        with patch.object(worker, 'api', side_effect=ConnectionError('lost response')), \
             patch.object(worker, 'remove_cache') as remove:
            self.assertFalse(worker.recover_uploaded_preview(self.job))
            remove.assert_not_called()

    def test_confirmed_unpublished_cache_can_be_removed(self):
        for rows in [[], [{'status': 'generating'}], [{'status': 'failed'}]]:
            with self.subTest(rows=rows), patch.object(worker, 'api', return_value=rows), \
                 patch.object(worker, 'remove_cache') as remove:
                self.assertFalse(worker.recover_uploaded_preview(self.job))
                remove.assert_called_once_with('fixture.pdf')

    def test_ready_but_invalidated_source_is_not_served(self):
        with patch.object(worker, 'api', return_value=[{'status': 'ready'}]), \
             patch.object(worker, 'source_current', return_value=False), \
             patch.object(worker, 'remove_cache') as remove:
            self.assertFalse(worker.recover_uploaded_preview(self.job))
            remove.assert_called_once()

    def test_in_flight_ready_commit_wins_over_cleanup(self):
        with patch.object(worker,'api',side_effect=[[{'status':'generating'}],[],[{'status':'ready'}]]) as api, \
             patch.object(worker,'source_current',return_value=True), \
             patch.object(worker,'remove_cache') as remove:
            self.assertTrue(worker.recover_uploaded_preview(self.job))
            self.assertIn('&status=eq.generating',api.call_args_list[1].args[1])
            remove.assert_not_called()


class CacheLocations(unittest.TestCase):
    owner = '11111111-1111-4111-8111-111111111111'
    source = '22222222-2222-4222-8222-222222222222'
    identity = '33333333-3333-4333-8333-333333333333'

    def job(self, bucket='cache', source='users'):
        return {'id': self.identity, 'owner_id': self.owner, 'source_id': self.source,
                'source_bucket': source, 'cache_bucket': bucket,
                'preview_path': ('previews/' + self.owner + '/' + self.source + '/' if bucket == 'cache' else '') + self.identity + '.pdf'}

    def test_library_cache_and_legacy_and_messenger_are_independent(self):
        for bucket, source in [('cache', 'users'), ('cache', 'user-files'),
                               ('file-previews', 'user-files'), ('file-previews', 'messenger-attachments')]:
            job = self.job(bucket, source)
            self.assertEqual(worker.cache_location(job), (bucket, job['preview_path']))
        with self.assertRaises(ValueError):
            worker.cache_location(self.job('cache', 'messenger-attachments'))

    def test_wrong_owner_source_job_and_bucket_are_rejected(self):
        for field, value in [('owner_id', self.source), ('source_id', self.identity),
                              ('id', self.owner), ('cache_bucket', 'users'), ('preview_path', '../source.pdf')]:
            job = self.job(); job[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                worker.cache_location(job)

    def test_cleanup_uses_only_explicit_cache_buckets(self):
        with patch.object(worker, 'api') as api:
            worker.remove_job_cache(self.job())
            self.assertEqual(api.call_args.args[1], '/storage/v1/object/cache')
            self.assertEqual(api.call_args.kwargs['json'], {'prefixes': [self.job()['preview_path']]})
            with self.assertRaises(ValueError):
                worker.remove_cache('source', 'users')
            self.assertEqual(api.call_count, 1)

    def test_scoped_receipts_and_messenger_reconciliation_remain_separate(self):
        def response(method, path, **kwargs):
            if path.endswith('/file_preview_cleanup_candidates'):
                return [{'path': self.job()['preview_path'], 'cache_bucket': 'cache'},
                        {'path': self.identity + '.pdf', 'cache_bucket': 'file-previews'}]
            return []
        with patch.object(worker, 'api', side_effect=response) as api:
            worker.cleanup()
            paths = [call.args[1] for call in api.call_args_list]
            self.assertIn('/storage/v1/object/cache', paths)
            self.assertIn('/storage/v1/object/file-previews', paths)
            self.assertIn('/rest/v1/rpc/messenger_reconcile_uploads', paths)
            self.assertIn('/rest/v1/rpc/messenger_reconcile_calls', paths)
            self.assertFalse(any('/file_preview_cleanup?' in path and call.args[0] == 'GET'
                                 for path, call in zip(paths, api.call_args_list)))


if __name__ == '__main__': unittest.main()
