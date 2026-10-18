import base64
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
import http_ece
import requests

spec = importlib.util.spec_from_file_location('dispatcher', Path(__file__).resolve().parents[1] / 'services/push-dispatcher/dispatcher.py')
dispatcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatcher)


class PushTests(unittest.TestCase):
    def job(self):
        return dict(subscription=dict(endpoint='https://fcm.googleapis.com/fcm/send/fixture', keys=dict(p256dh='B' * 87, auth='a' * 22)),
                    payload=dict(id='fixture-event', kind='message', body='Private fixture preview'),
                    expires_at=(datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat())

    def test_provider_allowlist_rejects_ssrf_and_redirects(self):
        for endpoint in ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2-db5p.notify.windows.com/x']:
            self.assertTrue(dispatcher.endpoint_allowed(endpoint))
        for endpoint in ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.invalid/x', 'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com:443/x', 'https://fcm.googleapis.com/x#fragment', 'https://fcm.googleapis.com/x\ny', 'https://fcm.googleapis.com\\@localhost/x', None]:
            self.assertFalse(dispatcher.endpoint_allowed(endpoint))
        with patch.object(requests.Session, 'request') as request:
            with dispatcher.PushSession() as session:
                self.assertFalse(session.trust_env)
                session.post('https://fcm.googleapis.com/x', allow_redirects=True)
                self.assertFalse(request.call_args.kwargs['allow_redirects'])
                with self.assertRaises(ValueError):
                    session.post('https://localhost/private')

    def test_key_is_persistent_and_only_public_key_is_returned(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'key.pem'
            public = dispatcher.load_key(path)
            self.assertEqual(len(public), 87)
            self.assertEqual(public, dispatcher.load_key(path))
            self.assertNotIn('PRIVATE', public)
            self.assertIn(b'PRIVATE KEY', path.read_bytes())

    def test_expired_payload_and_bad_endpoint_never_send(self):
        job = self.job()
        with patch.object(dispatcher, 'webpush') as sender:
            job['expires_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
            self.assertEqual(dispatcher.deliver(job, 'unused', sender), 'discard')
            job['subscription']['endpoint'] = 'https://localhost/secrets'
            self.assertEqual(dispatcher.deliver(job, 'unused', sender), 'expired')
            sender.assert_not_called()

    def test_provider_errors_cleanup_only_expired_devices(self):
        for code, expected in [(201, 'sent'), (404, 'expired'), (410, 'expired'), (429, 'retry'), (500, 'retry'), (401, 'retry'), (403, 'retry'), (302, 'retry')]:
            def sender(**kwargs):
                response = requests.Response(); response.status_code = code
                if code != 201:
                    raise dispatcher.WebPushException('Private provider response must never be logged', response=response)
                return response
            self.assertEqual(dispatcher.deliver(self.job(), 'unused', sender), expected)

    def test_real_web_push_encrypts_and_signs_without_network(self):
        key = ec.generate_private_key(ec.SECP256R1())
        public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        auth = b'fixture-auth-key!'
        encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip('=')
        job = self.job(); job['subscription']['keys'] = dict(p256dh=encode(public), auth=encode(auth))
        captured = {}

        def request(_session, method, url, **kwargs):
            captured.update(kwargs)
            response = requests.Response(); response.status_code = 201
            return response

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'key.pem'; dispatcher.load_key(path)
            with patch.object(requests.Session, 'request', request):
                self.assertEqual(dispatcher.deliver(job, path), 'sent')
        self.assertFalse(captured['allow_redirects'])
        self.assertEqual(captured['headers']['Content-Encoding'], 'aes128gcm')
        self.assertIn('vapid ', captured['headers']['Authorization'])
        self.assertNotIn(job['payload']['body'].encode(), captured['data'])
        decoded = http_ece.decrypt(captured['data'], private_key=key, auth_secret=auth, version='aes128gcm')
        self.assertEqual(json.loads(decoded), job['payload'])
        self.assertGreater(int(captured['headers']['ttl']), 0)
        self.assertLessEqual(int(captured['headers']['ttl']), 30)


if __name__ == '__main__':
    unittest.main()
