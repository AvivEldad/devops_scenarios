# The watchdog is "stuck" and the pipeline slot is occupied for an hour

## Briefing

`watchdog.py` curls the canary every minute from CI. One afternoon the canary
accepted the TCP connection and never sent HTTP headers. The job sat in
`urlopen()` until the runner's hour timeout killed it. There is no
`socket.timeout` in the code. The default for `urllib`/`requests` without
`timeout=` is **wait forever**.

Python-03 hangs because a *subprocess* is not bounded. This hang is the HTTP
client. Same operational result: a worker occupied, a queue backing up.

## Your Task

- Start the provided slow server (or any listener that accepts and does not
  reply) and show the client blocking.
- Put a timeout on every outbound call.
- Fail the check with a clear error and a non-zero exit when the deadline
  fires.

## Starter Files

### file: slow_server.py

```python
#!/usr/bin/env python3
import socket

s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 18081))
s.listen(1)
print("listening 127.0.0.1:18081 (accepts, never replies)", flush=True)
conn, _ = s.accept()
# hold the socket open so the client blocks in recv
while True:
    pass
```

### file: watchdog.py

```python
#!/usr/bin/env python3
import sys
from urllib.request import urlopen


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18081/health"
    print("checking %s" % url, flush=True)
    with urlopen(url) as resp:          # no timeout=
        body = resp.read()
    print("status %s bytes %d" % (resp.status, len(body)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 slow_server.py &
python3 watchdog.py
# checking http://127.0.0.1:18081/health
# ... hangs until you Ctrl-C or the CI runner kills the job
```

`ss` shows an ESTABLISHED connection. The application is not "slow". It is
waiting with no deadline.

## Expected Outcome

```bash
python3 watchdog.py; echo exit=$?
# checking http://127.0.0.1:18081/health
# error: health check timed out after 3s: http://127.0.0.1:18081/health
# exit=1
```

Every `urlopen` / `requests.get` / SDK call in the repo has an explicit
timeout (connect and read, separately if the library allows).

## Hints

### Hint 1 — The default is infinite

`urllib.request.urlopen(url)` and `requests.get(url)` without `timeout`
do not pick a sensible default. CI timeouts are not a substitute: they
kill the whole job with a useless error.

### Hint 2 — Connect vs read

A blackhole SYN needs `timeout` on connect. A server that accepts and
stalls needs a read timeout. In requests: `timeout=(2, 3)` is
`(connect, read)`. urllib: `urlopen(url, timeout=3)` covers both.

## Solution

Bound the call, catch the timeout, exit non-zero.

```python
from urllib.error import URLError
from urllib.request import urlopen

try:
    with urlopen(url, timeout=3) as resp:
        body = resp.read()
except URLError as exc:
    print("error: health check failed: %s" % exc, file=sys.stderr)
    return 1
```

- **No timeout is a production incident waiting on a hung peer.**
- **Runner-level timeouts** hide which URL stuck.
- **`requests` is not safer** until you pass `timeout=`.
- **SDK clients** (boto3, kubernetes, slack) have their own defaults —
  set them in one place when the process is a cron/CI watchdog.
