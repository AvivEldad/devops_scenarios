# The healthcheck that reports healthy while the app is broken

## Briefing

A container has been serving 500s for two hours. Docker reports it `(healthy)` the
entire time, so the orchestrator never restarted it and no alert fired.

A second container in the same stack is permanently `(unhealthy)` despite working
perfectly, and everyone has learned to ignore health status as a result.

Both healthchecks are wrong, in opposite directions.

## Your Task

- Start both containers and confirm the reported status contradicts reality.
- Explain what each healthcheck is actually testing.
- Write a healthcheck that reflects whether the service can do its job.

## Starter Files

### file: app.py

```python
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

BROKEN = os.environ.get("BREAK_BACKEND") == "1"


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if self.path == "/healthz":
            body = b"ok\n"
            code = 200
        elif BROKEN:
            body = b"backend unavailable\n"
            code = 500
        else:
            body = b"order accepted\n"
            code = 200
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


HTTPServer(("0.0.0.0", 8080), H).serve_forever()
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY app.py .

HEALTHCHECK CMD curl -f http://localhost:8080/healthz || exit 1

EXPOSE 8080
CMD ["python", "app.py"]
```

## Expected Failure

```bash
docker build -t shop .
docker run -d --name shop-broken -e BREAK_BACKEND=1 -p 8080:8080 shop
sleep 40
docker ps --format '{{.Names}}\t{{.Status}}'
```

Two problems appear at once.

The healthcheck cannot run at all, because `curl` is not installed in the slim image:

```
shop-broken   Up 40 seconds (unhealthy)
docker inspect shop-broken --format '{{json .State.Health.Log}}' | head -c 200
# "ExitCode":127,"Output":"OCI runtime exec failed: exec: \"curl\": executable file not found
```

Exit code 127 is "command not found" — the check has never once tested the
application. Install curl and the opposite problem appears: the app returns 500 for
every real request while `/healthz` returns 200 unconditionally, so the container
reports `(healthy)` while serving nothing but errors.

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/orders
# 500
docker ps --format '{{.Names}}\t{{.Status}}'
# shop-broken   Up 2 minutes (healthy)
```

## Expected Outcome

Health status must track whether the service can actually serve requests.

A working container reports healthy:

```bash
docker run -d --name shop-ok -p 8081:8080 shop
sleep 20
docker inspect shop-ok --format '{{.State.Health.Status}}'
# healthy
```

A broken backend reports unhealthy:

```bash
docker run -d --name shop-bad -e BREAK_BACKEND=1 -p 8082:8080 shop
sleep 40
docker inspect shop-bad --format '{{.State.Health.Status}}'
# unhealthy
```

The check runs successfully rather than failing to launch — inspect the log and
confirm the exit code is 0 or 1, never 127:

```bash
docker inspect shop-ok --format '{{json .State.Health.Log}}' | grep -o '"ExitCode":[0-9]*' | sort -u
# "ExitCode":0
```

The container becomes healthy quickly rather than after a long delay:

```bash
docker run -d --name shop-fast shop
sleep 12
docker inspect shop-fast --format '{{.State.Health.Status}}'
# healthy       <- not still "starting"
```

Startup does not produce spurious unhealthy states — during the grace period the
status must be `starting`, not `unhealthy`:

```bash
docker run -d --name shop-boot shop
docker inspect shop-boot --format '{{.State.Health.Status}}'
# starting
```

Clean up: `docker rm -f shop-broken shop-ok shop-bad shop-fast shop-boot 2>/dev/null`

## Hints

### Hint 1 — Check the healthcheck's own exit code first

```bash
docker inspect <name> --format '{{json .State.Health.Log}}' | python3 -m json.tool
```

Exit code 127 means the command does not exist in the image. `python:3.11-slim` has no
`curl`. A healthcheck that cannot run reports unhealthy forever and tells you nothing
about the application — and because "unhealthy" looks like a real result, it is easy to
misread for months.

Use something the image definitely has. For a Python image, Python itself:

```dockerfile
HEALTHCHECK CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/healthz', timeout=3).status==200 else 1)"
```

### Hint 2 — A healthcheck must exercise a real dependency

`/healthz` returns 200 unconditionally. It proves the process is running and the HTTP
server accepted a connection — which you already knew, because the container is up.

A useful check verifies the thing that actually breaks: can it reach its database, is
its cache responding, can it serve a representative request. That is the difference
between a liveness signal and a readiness signal, and the reason the container was
never restarted.

Set the timing parameters too — `interval`, `timeout`, `retries` and especially
`start-period` — or the defaults (30s interval, no grace period) will make a
slow-starting service look broken.

## Solution

Two faults: the check command was absent from the image, and the endpoint it targeted
could not fail.

Make the endpoint report real health:

```python
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

BROKEN = os.environ.get("BREAK_BACKEND") == "1"


def backend_reachable():
    # stand-in for a real dependency check: database ping, cache GET, etc.
    return not BROKEN


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if self.path == "/healthz":
            ok = backend_reachable()
            body = b"ok\n" if ok else b"backend unavailable\n"
            code = 200 if ok else 503
        elif BROKEN:
            body, code = b"backend unavailable\n", 500
        else:
            body, code = b"order accepted\n", 200
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


HTTPServer(("0.0.0.0", 8080), H).serve_forever()
```

And make the check runnable, with explicit timing:

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY app.py .

HEALTHCHECK --interval=5s --timeout=3s --retries=3 --start-period=10s \
  CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/healthz', timeout=2).status == 200 else 1)"

EXPOSE 8080
CMD ["python", "app.py"]
```

- **Verify the healthcheck can execute.** Exit code 127 is the giveaway, and it is
  extremely common with slim and distroless images that have no shell or `curl`. Always
  read `State.Health.Log` once after adding a check.
- **A check that cannot fail is worse than no check**, because it actively suppresses
  the signal. If the endpoint returns 200 without consulting anything, it only tells you
  the process has not crashed — and process liveness is already tracked.
- **Distinguish liveness from readiness.** Liveness answers "should this be restarted";
  readiness answers "should this receive traffic". Docker has one healthcheck;
  Kubernetes separates them, and conflating the two causes restart loops when a
  dependency is briefly unavailable.
- **`--start-period` is essential** for anything with a startup sequence. Failures during
  that window do not count toward `retries`, so a slow boot no longer looks like a
  fault.
- **Keep checks cheap.** They run on every interval for the life of the container; a
  check that queries the database heavily becomes a load source of its own.
