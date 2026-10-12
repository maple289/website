import importlib.util
from pathlib import Path
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location('health', Path(__file__).resolve().parents[1] / 'scripts/check-runtime-api.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class Response:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *_): pass


class ReadinessTests(unittest.TestCase):
    def test_transient_gateway_error_retries_without_reading_records_or_bodies(self):
        calls = []
        elapsed = [0]
        def open_request(request, **_):
            calls.append(request)
            if len(calls) == 2:
                raise urllib.error.HTTPError(request.full_url, 502, 'fixture-private-error', {}, None)
            return Response()
        health.wait_for_api('fixture-private-key', opener=open_request, clock=lambda: elapsed[0], sleep=lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds))
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(request.get_method() == 'GET' for request in calls))
        self.assertTrue(all('limit=0' in request.full_url for request in calls if '/rest/' in request.full_url))

    def test_persistent_failure_blocks_success_without_exposing_credentials(self):
        elapsed = [0]
        def open_request(request, **_):
            raise urllib.error.HTTPError(request.full_url, 502, 'fixture-private-key', {}, None)
        with self.assertRaisesRegex(RuntimeError, 'returned HTTP 502') as caught:
            health.wait_for_api('fixture-private-key', opener=open_request, clock=lambda: elapsed[0], sleep=lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds), timeout=4)
        self.assertNotIn('fixture-private-key', str(caught.exception))
        self.assertEqual(elapsed[0], 4)

    def test_missing_credential_fails_without_network_request(self):
        with self.assertRaisesRegex(RuntimeError, 'credential is unavailable'):
            health.wait_for_api('', opener=lambda *_: self.fail('Unexpected request'))


if __name__ == '__main__':
    unittest.main()
