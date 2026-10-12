"""Replay saved registration mail safely; never log recipients, bodies or keys."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import time
import requests


def dispatch_once(session, base, service_key, resend_key, sender, customers=False):
    if not resend_key:
        return 0
    headers = {'apikey': service_key, 'Authorization': 'Bearer ' + service_key}
    eligibility = {'operation': 'in.(admin_registration_notification,registration_receipt,registration_approved)' if customers else 'eq.admin_registration_notification'}
    if not sender:
        eligibility['sender'] = 'not.is.null'
    response = session.get(base + '/rest/v1/registration_email_deliveries', headers=headers,
                           params={'select': '*', 'status': 'neq.sent', 'attempts': 'lt.5',
                                   'and': '(or(first_attempt_at.is.null,first_attempt_at.gt.' + (datetime.now(timezone.utc)-timedelta(hours=23)).isoformat() + '),or(last_attempt_at.is.null,last_attempt_at.lt.' + (datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat() + '))',
                                   'order': 'last_attempt_at.asc.nullsfirst', 'limit': '10', **eligibility}, timeout=20)
    response.raise_for_status()
    processed = 0
    for delivery in response.json():
        operation = delivery['operation']
        if operation != 'admin_registration_notification' and (not customers or operation not in ('registration_receipt', 'registration_approved')):
            continue
        if not resend_key or not (delivery.get('sender') or sender):
            continue  # Missing configuration never consumes a delivery attempt.
        claim = session.post(base + '/rest/v1/rpc/claim_registration_email', headers=headers,
                             json={'delivery_id': delivery['id']}, timeout=20)
        claim.raise_for_status()
        if claim.json() is not True:
            continue
        payload = {'from': delivery.get('sender') or sender, 'to': [delivery['recipient']],
                   'subject': delivery['subject'], 'html': delivery['html']}
        if delivery.get('plain_text'):
            payload['text'] = delivery['plain_text']
        try:
            # Pace this worker's burst; other site requests share the provider.
            time.sleep(0.6)
            sent = session.post('https://api.resend.com/emails', headers={
                'Authorization': 'Bearer ' + resend_key, 'Idempotency-Key': 'registration/' + delivery['id']},
                json=payload, timeout=20)
            provider = sent.json()
            provider_id = provider.get('id') if isinstance(provider, dict) else None
            accepted = sent.ok and isinstance(provider_id, str) and bool(provider_id)
            result = {'status': 'sent' if accepted else 'failed', 'message_id': provider_id if accepted else None,
                      'http_status': sent.status_code, 'error_type': None if accepted else 'provider_rejected',
                      'error_message': None if accepted else 'Provider rejected delivery; inspect the provider dashboard.'}
        except (requests.RequestException, ValueError):
            result = {'status': 'failed', 'error_type': 'transport_error', 'error_message': 'Delivery response unavailable; retry uses the same idempotency key.'}
        saved = session.patch(base + '/rest/v1/registration_email_deliveries', headers=headers,
                              params={'id': 'eq.' + delivery['id']}, json=result, timeout=20)
        saved.raise_for_status()
        processed += 1
        Path('/tmp/email-heartbeat').touch()
    return processed


def main():
    session = requests.Session()
    while True:
        Path('/tmp/email-heartbeat').touch()
        try:
            sender = os.environ.get('RESEND_FROM_EMAIL', '')
            name = os.environ.get('RESEND_FROM_NAME', '')
            if name and '<' not in sender and not any(char in name for char in '\r\n<>'):
                sender = f'{name} <{sender}>'
            if '\r' in sender or '\n' in sender:
                sender = ''
            count = dispatch_once(session, os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SERVICE_ROLE_KEY'],
                                  os.environ.get('RESEND_API_KEY', ''), sender, os.environ.get('CUSTOMER_EMAILS_ENABLED') == 'true')
            print(json.dumps({'operation': 'email_dispatch', 'processed': count}), flush=True)
        except (requests.RequestException, ValueError, KeyError):
            print(json.dumps({'operation': 'email_dispatch', 'category': 'retryable_error'}), flush=True)
        time.sleep(60)


if __name__ == '__main__':
    main()
