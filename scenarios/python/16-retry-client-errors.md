# The retry loop turned a 404 into a 20-minute outage

## Briefing

`fetch_manifest.py` wraps downloads with "resilience": on any exception or
non-200, sleep and try again, ten times. The manifest URL was renamed.
The registry now returns **404** in 20ms. The job slept 2+4+8… minutes,
the deploy window closed, and the error at the end was still 404.

Retries are for **transient** failures (connect, 429, 502, 503). They are
not for 400, 401, 403, 404, or a typo in the path. Blind `except Exception`
plus retry is how a fast fail becomes a timeout incident.

## Your Task

- Point the client at a 404 server and show it retrying.
- Retry only a declared set of transient errors; fail immediately on 4xx
  (except 429, which is a later drill).
- Print the status once and exit non-zero on a permanent failure.

## Starter Files

### file: fake_registry.py

```python
#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"error":"manifest unknown"}'
        self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

HTTPServer(("127.0.0.1", 18084), H).serve_forever()
```

### file: fetch_manifest.py

```python
#!/usr/bin/env python3
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

URL = "http://127.0.0.1:18084/v2/app/manifests/v3"


def main():
    delay = 1
    last = None
    for attempt in range(1, 11):
        try:
            with urlopen(URL, timeout=5) as resp:
                open("manifest.json", "wb").write(resp.read())
            print("saved manifest.json")
            return 0
        except (HTTPError, URLError, TimeoutError) as exc:
            last = exc
            print("attempt %d failed: %s — retry in %ss" % (attempt, exc, delay))
            time.sleep(delay)
            delay *= 2
    print("giving up: %s" % last)
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 fake_registry.py &
python3 fetch_manifest.py
# attempt 1 failed: HTTP Error 404: Not Found — retry in 1s
# attempt 2 failed: HTTP Error 404: Not Found — retry in 2s
# ...
```

Ten tries, more than 15 minutes if you let the sleeps run. The answer
cannot change.

## Expected Outcome

```bash
python3 fetch_manifest.py; echo exit=$?
# error: GET ... -> 404 (permanent, not retrying)
# body: {"error":"manifest unknown"}
# exit=1
```

A connection reset still retries a few times with a cap.

## Hints

### Hint 1 — Classify before sleep

`HTTPError.code` in `{408, 429, 500, 502, 503, 504}` → retry. `404`/`401`
→ return 1. `URLError` without a code → retry with a cap.

### Hint 2 — Cap both attempts and total wall time

Ten retries with doubling sleep is a 17-minute hang. CI jobs need a
budget (`deadline = time.time() + 30`) as well as an attempt count.

## Solution

```python
TRANSIENT = {408, 429, 500, 502, 503, 504}

try:
    with urlopen(URL, timeout=5) as resp:
        ...
except HTTPError as exc:
    if exc.code not in TRANSIENT:
        print("error: GET %s -> %s (permanent, not retrying)" % (URL, exc.code),
              file=sys.stderr)
        return 1
    # else retry ...
```

- **404 will still be 404 after backoff.** Do not spend the deploy window
  proving it.
- **`except Exception` plus sleep** is how watchdogs DDoS a dying API
  *and* hide typos.
- **tenacity/urllib3 retry`** need `status_forcelist`, not "everything".
- **Log attempt, status, and whether you will retry** so the next person
  can see it was classified.
