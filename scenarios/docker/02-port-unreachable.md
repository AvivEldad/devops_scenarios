# Container is healthy, port is dead

## Briefing

The `checkout` service was containerised last week by someone who has since moved
teams. It runs. The logs look perfect. `docker ps` shows the port mapped exactly as
you would expect.

And no request from your machine has ever reached it.

## Your Task

Save the starter files, then:

1. Build the image as `checkout:v2`.
2. Run it detached, named `checkout`, so that `http://localhost:8080` on your host
   reaches the service.
3. Get a `200` response from your host.

You may change the Dockerfile and the `docker run` command. You may change **one
line** of `app.py` — the line that decides which interface the server binds to.
Do not change the application logic.

```bash
mkdir -p ~/breakfix/docker-02 && cd ~/breakfix/docker-02
```

## Starter Files

### file: app.py

```python
from http.server import BaseHTTPRequestHandler, HTTPServer
import os

PORT = int(os.environ.get("PORT", "5000"))
BIND = "127.0.0.1"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"checkout ok\n")

    def log_message(self, fmt, *args):
        print("request %s" % (fmt % args), flush=True)


print("checkout listening on %s:%d" % (BIND, PORT), flush=True)
HTTPServer((BIND, PORT), Handler).serve_forever()
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY app.py .

EXPOSE 8080

CMD ["python3", "app.py"]
```

## Expected Failure

```bash
docker build -t checkout:v2 .
docker run -d --name checkout -p 8080:8080 checkout:v2
docker ps
```

Everything looks correct. The container is `Up`, the ports column reads
`0.0.0.0:8080->8080/tcp`, and the logs are reassuring:

```
checkout listening on 127.0.0.1:5000
```

Yet:

```bash
curl -s http://localhost:8080
# curl: (52) Empty reply from server   -- or connection reset
```

There are **two independent faults** here, and fixing only one leaves you with the
same symptom. That is what makes this realistic: the error message never changes,
so you cannot tell from the outside whether you made progress.

## Expected Outcome

The mapping, the listener, and the request must all agree.

```bash
curl -s http://localhost:8080
# checkout ok
```

The process inside the container listens on all interfaces, on the port you mapped:

```bash
docker exec checkout python3 -c "import socket;s=socket.socket();print(s.connect_ex(('0.0.0.0',8080)))"
# 0        (0 means something is accepting connections there)
```

The startup log agrees with reality:

```bash
docker logs checkout
# checkout listening on 0.0.0.0:8080
```

And the request actually reached the application, rather than dying in the
network layer:

```bash
docker logs checkout | grep request
# request "GET / HTTP/1.1" 200 -
```

## Hints

### Hint 1 — Compare three numbers

Write down the port in each of these places and compare them:

- the port the application prints in its log
- the container-side port in your `-p HOST:CONTAINER` flag
- the port in `EXPOSE`

`-p 8080:8080` forwards host `8080` to container `8080`. If nothing is listening on
container port `8080`, Docker accepts your connection at the host and then has
nowhere to send it. `EXPOSE` is only documentation and never affects this.

### Hint 2 — Inside the container is a different network namespace

Fix the port and it still fails. Now look at the bind address.

`127.0.0.1` means "the loopback interface of this network namespace". Inside a
container that is the container's own loopback, reachable only by processes in that
same container. Docker's port forwarding arrives on the container's *ethernet*
interface, which a loopback-only listener never sees.

Prove it to yourself:

```bash
docker exec checkout curl -s http://127.0.0.1:8080   # works from inside
curl -s http://localhost:8080                        # still fails from outside
```

### Hint 3 — Two ways to set the port

The application already reads `PORT` from the environment, so you do not have to
edit the file to change the port:

```bash
docker run -d --name checkout -p 8080:8080 -e PORT=8080 checkout:v2
```

Alternatively set a default in the Dockerfile with `ENV PORT=8080`. The bind
address, however, is hard-coded — that is the one line you are allowed to change.

## Solution

Two faults, both common in real handovers.

**Fault 1: port mismatch.** The application defaults to `5000`; the run command maps
host `8080` to container `8080`. Nothing listens on `8080`.

**Fault 2: loopback bind.** `BIND = "127.0.0.1"` restricts the listener to the
container's own loopback interface, so forwarded traffic can never reach it.

Change the bind address in `app.py`:

```python
BIND = "0.0.0.0"
```

Set the port through the environment in the Dockerfile so the image is self-consistent:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY app.py .

ENV PORT=8080

EXPOSE 8080

CMD ["python3", "app.py"]
```

Rebuild and run:

```bash
docker rm -f checkout 2>/dev/null
docker build -t checkout:v2 .
docker run -d --name checkout -p 8080:8080 checkout:v2
curl -s http://localhost:8080
```

A note on `0.0.0.0`: binding to all interfaces is correct *inside a container*,
because the container boundary is your isolation. On a bare host it is a real
exposure decision. The rule is not "always bind 0.0.0.0", it is "bind to the
interface the traffic actually arrives on".

## What You Learned

"The container is running" and "the container is serving" are unrelated statements,
and most monitoring only checks the first one.

When traffic does not arrive, walk the path in order rather than guessing: host port,
the mapping, the container port, the bind address, then the application. This
scenario also teaches the harder lesson that a single symptom can hide several
faults — so after each change, re-test and expect the failure to *change*, not
necessarily disappear.
