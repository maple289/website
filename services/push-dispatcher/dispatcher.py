"""Durable, per-device Web Push delivery. Never log payloads, URLs or keys."""
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
import requests
from pywebpush import webpush, WebPushException


def endpoint_allowed(endpoint):
    try:
        url = urlsplit(endpoint)
        host = url.hostname or ""
        return (url.scheme == "https" and not url.username and not url.password
                and url.port is None and not url.fragment and len(endpoint) < 4096
                and bool(url.path) and not re.search(r"[\s\\]", endpoint)
                and bool(re.fullmatch(r"fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|(?:[a-z0-9-]+\.)*notify\.windows\.com", host)))
    except (TypeError, ValueError):
        return False


class PushSession(requests.Session):
    def __init__(self):
        super().__init__()
        self.trust_env = False

    def request(self, method, url, **kwargs):
        if not endpoint_allowed(url):
            raise ValueError("Invalid push provider")
        kwargs["allow_redirects"] = False
        return super().request(method, url, **kwargs)


def load_key(path):
    """Generate once inside a private persistent volume, never in frontend env."""
    path = Path(path)
    if not path.exists():
        key = ec.generate_private_key(ec.SECP256R1())
        encoded = key.private_bytes(serialization.Encoding.PEM,
                                    serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption())
        # Exclusive creation prevents concurrent starts from silently rotating it.
        try:
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as handle:
                handle.write(encoded)
        except FileExistsError:
            pass
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("Invalid push key type")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(public).decode().rstrip("=")


def ttl_for(job, now=None):
    now = now or datetime.now(timezone.utc)
    expires = datetime.fromisoformat(job["expires_at"].replace("Z", "+00:00"))
    remaining = int((expires - now).total_seconds())
    return max(0, min(86400, remaining))


def deliver(job, key_path, sender=webpush):
    # Call cleanup is page/SW reconciliation, never a replacement or silent push.
    # All real pushes must remain user-visible (especially on Safari).
    if job["payload"].get("kind") == "call-closed":
        return "discard"
    if not endpoint_allowed(job["subscription"].get("endpoint")):
        return "expired"
    ttl = ttl_for(job)
    if not ttl:
        return "discard"
    payload = json.dumps(job["payload"], separators=(",", ":"), ensure_ascii=False)
    if len(payload.encode()) > 3000:
        return "discard"
    kind = job["payload"]["kind"]
    # The SW groups message/call invitations by conversation/call ID.
    with PushSession() as session:
        try:
            response = sender(subscription_info=job["subscription"], data=payload,
                              vapid_private_key=str(key_path),
                              vapid_claims={"sub": os.environ.get("VAPID_SUBJECT", "https://myhostage.ca")},
                              ttl=ttl, timeout=12, headers={"Urgency": "high" if kind != "message" else "normal"},
                              requests_session=session)
            status = response.status_code
        except WebPushException as exc:
            status = exc.response.status_code if exc.response is not None else 0
        except (requests.RequestException, ValueError):
            return "retry"
    if status in (404, 410):
        return "expired"
    if 200 <= status <= 202:
        return "sent"
    # Includes provider 401/403: retain the subscription for bounded retries rather
    # than erasing every device on a temporary VAPID configuration error.
    return "retry"


def rpc(action, data):
    response = requests.post(os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/messenger_push_worker",
                             headers={"apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
                                      "Authorization": "Bearer " + os.environ["SUPABASE_SERVICE_ROLE_KEY"]},
                             json={"p_action": action, "p_data": data}, timeout=20)
    response.raise_for_status()
    return response.json()


def main():
    key_path = os.environ.get("VAPID_KEY_FILE", "/var/lib/push/vapid.pem")
    public_key = load_key(key_path)
    last_heartbeat = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        while True:
            try:
                if time.monotonic() - last_heartbeat > 30:
                    rpc("heartbeat", {"public_key": public_key})
                    last_heartbeat = time.monotonic()
                jobs = rpc("claim", {})
                results = list(pool.map(lambda job: deliver(job, key_path), jobs))
                for job, status in zip(jobs, results):
                    rpc("complete", {"id": job["id"], "lease": job["lease"], "status": status})
                Path("/tmp/push-heartbeat").touch()
            except Exception:
                # Exceptions can contain endpoint capability URLs/auth headers.
                # Only a fixed diagnostic, never exception repr/HTTP bodies.
                print("Push dispatcher cycle failed; queued events will retry", flush=True)
            time.sleep(2)


if __name__ == "__main__":
    main()
