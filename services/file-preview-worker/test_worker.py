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


if __name__ == '__main__': unittest.main()
