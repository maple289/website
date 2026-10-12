"""Bounded, read-only gateway readiness check with no credential/body output."""
import os
import time
import urllib.error
import urllib.request


def wait_for_api(key, opener=urllib.request.urlopen, clock=time.monotonic, sleep=time.sleep, timeout=90):
    if not key:
        raise RuntimeError('Runtime API readiness credential is unavailable')
    routes = ['/auth/v1/health', '/rest/v1/profiles?select=id&limit=0']
    deadline = clock() + timeout
    failure = 'API readiness check timed out'
    while True:
        ready = True
        for route in routes:
            request = urllib.request.Request('http://kong:8000' + route,
                headers={'apikey': key, 'Authorization': 'Bearer ' + key})
            try:
                with opener(request, timeout=5) as response:
                    if response.status != 200:
                        failure = route.split('?')[0] + ' returned HTTP ' + str(response.status)
                        ready = False
            except urllib.error.HTTPError as error:
                failure = route.split('?')[0] + ' returned HTTP ' + str(error.code)
                ready = False
            except (urllib.error.URLError, TimeoutError, OSError):
                failure = route.split('?')[0] + ' is unreachable'
                ready = False
        if ready:
            return
        if clock() >= deadline:
            raise RuntimeError(failure)
        sleep(min(2, max(0, deadline - clock())))


if __name__ == '__main__':
    try:
        wait_for_api(os.environ.get('SUPABASE_SERVICE_ROLE_KEY', ''))
    except RuntimeError as error:
        print(str(error))
        raise SystemExit(1)
    print('Authentication and REST/database gateway readiness passed.')
