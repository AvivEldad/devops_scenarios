# Fifty crons woke up at :00 and the API spent 10 minutes saying 429

## Briefing

A fleet of jump hosts runs `inventory.py` at `0 * * * *`. The API rate
limit is 30 req/min. All 50 processes retry immediately on 429, without
reading `Retry-After`, and without jitter. The limit never cools down.
Humans hitting the API from laptops also get 429. Python-16 is retrying
**404**. This is retrying **429 the wrong way** — a thundering herd.

## Your Task

- Hit a fake API that returns 429 with `Retry-After: 2` and show the
  client looping without waiting that long (or waiting 0 and amplifying).
- Honour `Retry-After` (delta-seconds or HTTP-date), add jitter, cap
  attempts.
- Show a successful GET after waiting once, without a retry storm.

## Starter Files

### file: fake_limited.py

```python
#!/usr/bin/env python3
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

START = time.time()

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if time.time() - START < 2.5:
            self.send_response(429)
            self.send_header("Retry-After", "2")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"rate limited"}')
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"items":[1,2,3]}')

    def log_message(self, *a):
        pass

HTTPServer(("127.0.0.1", 18085), H).serve_forever()
```

### file: inventory.py

```python
#!/usr/bin/env python3
import sys
import time
from urllib.error import HTTPError
from urllib.request import urlopen

URL = "http://127.0.0.1:18085/items"


def main():
    for attempt in range(20):
        try:
            with urlopen(URL, timeout=5) as resp:
                print(resp.read().decode())
                return 0
        except HTTPError as exc:
            if exc.code != 429:
                raise
            print("429 — retrying immediately (attempt %d)" % attempt, flush=True)
            time.sleep(0.05)   # "so we don't hot-loop" — still a herd
    print("giving up")
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 fake_limited.py &
python3 inventory.py
# 429 — retrying immediately (attempt 0)
# 429 — retrying immediately (attempt 1)
# ... dozens of lines in 2 seconds ...
```

The server had asked for 2 seconds. The client asked 40 times. Multiply
by 50 hosts.

## Expected Outcome

```bash
python3 inventory.py
# 429 Retry-After=2 — sleeping 2.3s (attempt 1)
# {"items":[1,2,3]}
```

One or two 429s, then success. No burst.

## Hints

### Hint 1 — Read the header

`exc.headers.get("Retry-After")` is seconds or an HTTP-date. Sleep at
least that long. If it is missing, exponential backoff with a cap
(1, 2, 4, …, 32s).

### Hint 2 — Jitter is not optional at fleet scale

`sleep(retry_after * (1 + random.random() * 0.3))` so 50 crons do not
wake in the same millisecond. Stagger the crontab (`sleep $((RANDOM%60))`).

## Solution

```python
import random
from email.utils import parsedate_to_datetime

def retry_after_seconds(exc, default=1):
    raw = exc.headers.get("Retry-After") if hasattr(exc, "headers") else None
    if not raw:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        when = parsedate_to_datetime(raw)
        return max(0.0, (when.timestamp() - time.time()))

# sleep(retry_after_seconds(exc) * (1 + random.random() * 0.3))
```

- **429 means stop**, not "try harder now".
- **Retry-After is part of the protocol.** Ignoring it is a fleet outage.
- **Jitter + staggered cron** keep a limit usable.
- **Token buckets in the client** (or a shared proxy) beat 50 independent
  tight loops.
