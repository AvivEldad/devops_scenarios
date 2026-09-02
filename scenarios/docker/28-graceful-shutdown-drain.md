# Rolling deploys drop connections for ten seconds

## Briefing

Every deploy of the web service produces a burst of 502s and reset connections for
about ten seconds. The team has scheduled deploys for 3 a.m. to hide it.

The application handles `SIGTERM` correctly and drains in-flight requests when it gets
the chance. It is not getting the chance, for two reasons: one about how the process
receives the signal, and one about what the load balancer is still doing while the
process shuts down.

## Your Task

- Run the container, send it a stop, and measure how long shutdown takes and whether
  in-flight requests survive.
- Determine whether the process is even receiving `SIGTERM`.
- Fix signal delivery, then fix the drain ordering so no request is dropped.
- Confirm a stop under load loses zero requests.

## Starter Files

### file: server.py

```python
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

draining = threading.Event()


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if self.path == "/healthz":
            code = 503 if draining.is_set() else 200
            self._reply(code, b"health\n")
            return
        # a request that takes 2 seconds of real work
        time.sleep(2)
        self._reply(200, b"done\n")

    def _reply(self, code, body):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = ThreadingHTTPServer(("0.0.0.0", 8080), H)


def on_term(signum, frame):
    print("SIGTERM: draining", flush=True)
    draining.set()
    time.sleep(5)          # stop taking new traffic, let in-flight finish
    print("shutdown", flush=True)
    srv.shutdown()


signal.signal(signal.SIGTERM, on_term)
print("server up", flush=True)
srv.serve_forever()
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY server.py .
CMD python server.py
```

## Expected Failure

```bash
docker build -t web .
docker run -d --name web -p 8080:8080 web

# start a slow request in the background, then stop the container
curl -s localhost:8080/work & 
sleep 0.5
time docker stop web
```

```
real    0m10.3s
```

Ten seconds — the default stop timeout — followed by a kill. The draining message never
printed:

```bash
docker logs web
# server up
```

The process is PID... not what you think:

```bash
docker run -d --name web2 web
docker exec web2 ps -eo pid,comm
#   PID COMMAND
#     1 sh
#     8 python
```

`CMD` in shell form put `/bin/sh` at PID 1, and it does not forward `SIGTERM`. The
Python handler never ran, so the drain logic never executed, and every in-flight and
incoming request during the kill window was reset.

## Expected Outcome

A stop drains cleanly and drops nothing.

**The process receives the signal and shuts down promptly:**

```bash
docker run -d --name web -p 8080:8080 web
docker stop web
docker logs web
# server up
# SIGTERM: draining
# shutdown
```

**Stop is fast, not the full timeout:**

```bash
docker run -d --name web web
time docker stop web
# real  0m5-6s        <- the drain window, not 10s+ kill
```

**Python is PID 1:**

```bash
docker run -d --name web web
docker exec web ps -eo pid,comm | head -2
#   PID COMMAND
#     1 python
```

**Zero requests are dropped during a stop under load.** Fire continuous requests, stop
mid-flight, and count failures:

```bash
docker run -d --name web -p 8080:8080 web
( for i in $(seq 1 30); do
    curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/work &
    sleep 0.2
  done; wait ) > codes.txt &
sleep 2
docker stop web
grep -vc 200 codes.txt
# 0        <- every in-flight request completed
```

**Health goes unhealthy before the drain**, so a real load balancer stops sending new
traffic first:

```bash
docker run -d --name web -p 8080:8080 web
( docker stop web & )
sleep 1
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/healthz
# 503        <- draining, LB would remove it from rotation
```

Clean up: `docker rm -f web web2 2>/dev/null; rm -f codes.txt`

## Hints

### Hint 1 — Signal delivery first

The drain logic is fine; it never runs because `/bin/sh` is PID 1 and swallows
`SIGTERM`. Use exec form so Python is PID 1 and receives the signal directly:

```dockerfile
CMD ["python", "server.py"]
```

Confirm with `ps -eo pid,comm` inside the container — PID 1 must be your process.

### Hint 2 — Drain order: stop traffic, then stop the server

Even with signals working, dropping connections is about *ordering*. The correct
sequence on `SIGTERM` is:

1. Flip the health check to failing (or unready), so the load balancer removes this
   instance from rotation.
2. Wait long enough for the LB's health interval to notice — new requests stop arriving.
3. Let in-flight requests finish.
4. Shut the server down.

If you shut down before the LB has stopped routing, the requests it sends in that window
are reset. The health endpoint returning 503 while draining is what makes step 1 work.

### Hint 3 — Give the container time to drain

`docker stop` waits 10 seconds by default, then `SIGKILL`. If your drain needs longer,
raise it: `docker stop -t 30`, or `STOPSIGNAL` / `stop_grace_period` in Compose. In
Kubernetes this is `terminationGracePeriodSeconds`, and the drain must fit inside it.

## Solution

Two faults: shell-form `CMD` prevented the signal reaching Python, and the drain must be
ordered against the load balancer's health interval.

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY server.py .

STOPSIGNAL SIGTERM
# exec form: python is PID 1 and receives SIGTERM directly
CMD ["python", "server.py"]
```

The server already drains in the right order — fail health, pause, finish in-flight,
shut down — it simply never received the signal. With exec form it works. Tune the
window to your load balancer:

```python
def on_term(signum, frame):
    print("SIGTERM: marking unready", flush=True)
    draining.set()                 # /healthz now returns 503
    time.sleep(LB_HEALTH_INTERVAL) # let the LB remove us from rotation
    print("draining in-flight requests", flush=True)
    # give slow handlers time to finish before stopping the server
    threading.Thread(target=srv.shutdown).start()
```

And allow enough grace at the platform:

```yaml
services:
  web:
    build: .
    stop_grace_period: 30s
```

- **Signal delivery is a prerequisite for graceful anything.** Exec form so your process
  is PID 1, or the most careful shutdown code never runs. This is the same fault as the
  beginner signals scenario, and it is astonishingly common in production.
- **Zero-downtime deploys are an ordering problem, not just a shutdown problem.** The
  instance must leave the load balancer's rotation *before* it stops accepting
  connections. Failing the readiness/health check first is the mechanism; a fixed sleep
  tuned to the health interval is the crude-but-effective version.
- **The grace period must exceed the drain time.** If `docker stop -t` or
  `terminationGracePeriodSeconds` is shorter than your drain, the platform kills you
  mid-drain and you drop exactly the requests you were trying to protect.
- **This maps directly to Kubernetes:** a `preStop` hook that sleeps, a readiness probe
  that fails on shutdown, and `terminationGracePeriodSeconds` sized to fit. The kubelet
  removes the pod from Service endpoints when readiness fails, which is the equivalent of
  leaving the load balancer rotation.
- **`STOPSIGNAL`** documents and sets which signal `docker stop` sends, in case your
  runtime expects something other than `SIGTERM`.
