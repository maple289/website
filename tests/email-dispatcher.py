import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock

spec=importlib.util.spec_from_file_location('dispatcher',Path(__file__).resolve().parents[1]/'services/email-dispatcher/dispatcher.py')
dispatcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(dispatcher)

class Response:
    ok=True
    status_code=200
    def __init__(self,data): self.data=data
    def json(self): return self.data
    def raise_for_status(self): pass

class FakeSession:
    def __init__(self,claim=True,fail=False): self.calls=[];self.claim=claim;self.fail=fail
    def get(self,url,**options):
        self.calls.append(('get',url,options))
        return Response([dict(id='fixture-id',operation='admin_registration_notification',recipient='fixture@example.invalid',sender='fixture@example.invalid',subject='Fixture',html='Fixture',plain_text='Fixture')])
    def post(self,url,**options):
        self.calls.append(('post',url,options))
        if self.fail and 'api.resend.com' in url:
            raise dispatcher.requests.ConnectionError('fixture-provider-key')
        return Response(self.claim if '/rpc/' in url else {'id':'provider-fixture'})
    def patch(self,url,**options): self.calls.append(('patch',url,options));return Response(None)

class DispatcherTests(unittest.TestCase):
    @patch.object(dispatcher,'Path',MagicMock())
    def test_reuses_ledger_claim_and_provider_key(self):
        session=FakeSession();self.assertEqual(dispatcher.dispatch_once(session,'https://fixture.invalid','fixture-service','fixture-provider','fixture@example.invalid'),1)
        provider=next(call for call in session.calls if 'api.resend.com' in call[1])
        self.assertEqual(provider[2]['headers']['Idempotency-Key'],'registration/fixture-id')
        self.assertEqual(session.calls[-1][2]['json']['status'],'sent')
        self.assertIn('first_attempt_at.gt.',session.calls[0][2]['params']['and'])
        self.assertIn('last_attempt_at.lt.',session.calls[0][2]['params']['and'])
        self.assertEqual(session.calls[0][2]['params']['operation'],'eq.admin_registration_notification')
    def test_missing_configuration_and_claimed_delivery_never_send(self):
        for key,claim in [('',True),('fixture-provider',False)]:
            session=FakeSession(claim);self.assertEqual(dispatcher.dispatch_once(session,'https://fixture.invalid','fixture-service',key,''),0)
            self.assertFalse(any('api.resend.com' in call[1] for call in session.calls))
    @patch.object(dispatcher,'Path',MagicMock())
    def test_failed_transport_retains_safe_retry_state(self):
        session=FakeSession(fail=True)
        self.assertEqual(dispatcher.dispatch_once(session,'https://fixture.invalid','fixture-service','fixture-provider','',True),1)
        result=session.calls[-1][2]['json']
        self.assertEqual(result['status'],'failed')
        self.assertNotIn('fixture-provider-key',result['error_message'])
        self.assertEqual(session.calls[0][2]['params']['sender'],'not.is.null')
        self.assertIn('registration_approved',session.calls[0][2]['params']['operation'])

if __name__=='__main__': unittest.main()
