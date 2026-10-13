import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock
import hashlib
import re

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
    @patch.object(dispatcher.time,'sleep')
    def test_approval_retry_keeps_credential_and_body_private_and_stable(self, _):
        class ApprovalSession(FakeSession):
            def get(self,url,**options):
                result=super().get(url,**options)
                result.data[0]['operation']='registration_approved'
                return result
            def post(self,url,**options):
                if 'issue_initial_temporary_password' in url:
                    self.calls.append(('post',url,options))
                    return Response({'expires_at':'2026-10-13T01:00:00+00:00'})
                return super().post(url,**options)
        session=ApprovalSession()
        for _ in range(2):
            self.assertEqual(dispatcher.dispatch_once(session,'https://fixture.invalid','fixture-service','fixture-provider','fixture@example.invalid',False),1)
        provider=[call for call in session.calls if 'api.resend.com' in call[1]]
        self.assertEqual(provider[0][2],provider[1][2])
        password=re.search(r'Temporary password: ([A-Za-z0-9_-]{12})',provider[0][2]['json']['text']).group(1)
        self.assertEqual(password,'pXUs88ghgCXK')  # Shared fixture vector with the Edge handler.
        issuance=next(call for call in session.calls if 'issue_initial_temporary_password' in call[1])
        self.assertEqual(issuance[2]['json']['p_password_hash'],hashlib.sha256(password.encode()).hexdigest())
        self.assertNotIn(password,str([call for call in session.calls if call[0]=='patch']))
    @patch.object(dispatcher,'Path',MagicMock())
    def test_reuses_ledger_claim_and_provider_key(self):
        session=FakeSession();self.assertEqual(dispatcher.dispatch_once(session,'https://fixture.invalid','fixture-service','fixture-provider','fixture@example.invalid'),1)
        provider=next(call for call in session.calls if 'api.resend.com' in call[1])
        self.assertEqual(provider[2]['headers']['Idempotency-Key'],'registration/fixture-id')
        self.assertEqual(session.calls[-1][2]['json']['status'],'sent')
        self.assertIn('first_attempt_at.gt.',session.calls[0][2]['params']['and'])
        self.assertIn('last_attempt_at.lt.',session.calls[0][2]['params']['and'])
        self.assertEqual(session.calls[0][2]['params']['operation'],'in.(admin_registration_notification,registration_approved)')
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
