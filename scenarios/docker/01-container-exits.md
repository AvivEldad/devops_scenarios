# The container that will not stay running

## Briefing

You joined a team that ships a tiny internal HTTP service called `orders-api`.
A colleague left you the application file and a Dockerfile "that definitely builds".

They were right: it builds. That is the whole problem. A green build tells you nothing
about whether the container does any work.

## Your Task

Create a scratch directory, save the two starter files into it, then:

1. Build the image and tag it `orders-api:v1`.
2. Run it as a detached container named `orders`, publishing the service on port `8080` of your machine.
3. Confirm the service answers HTTP requests.

Do not rewrite the application. The Python file is correct.

```bash
mkdir -p ~/breakfix/docker-01 && cd ~/breakfix/docker-01
```

## Starter Files

### file: app.py

```python
from http.server import BaseHTTPRequestHandler, HTTPServer
import os

PORT = int(os.environ.get("PORT", "8080"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"orders-api ok\n")

    def log_message(self, fmt, *args):
        print("request %s" % (fmt % args), flush=True)


print("orders-api listening on port %d" % PORT, flush=True)
HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY app.py .

EXPOSE 8080
```

## Expected Failure

The build succeeds and prints an image ID. Then this happens:

```bash
docker build -t orders-api:v1 .
docker run -d --name orders -p 8080:8080 orders-api:v1
docker ps
```

`docker ps` shows nothing. No error, no crash message, no stack trace.
The container is already gone, and `curl` refuses to connect:

```
curl: (7) Failed to connect to localhost port 8080: Connection refused
```

This silence is the interesting part. A container that exits `0` looks
identical to a successful run in most dashboards.

## Expected Outcome

When you have fixed it, all four of these must be true.

The container is up and has not restarted:

```bash
docker ps --filter name=orders --format '{{.Names}} {{.Status}} {{.Ports}}'
# orders   Up 30 seconds   0.0.0.0:8080->8080/tcp
```

The application logged its startup line:

```bash
docker logs orders
# orders-api listening on port 8080
```

The service answers on your host:

```bash
curl -s http://localhost:8080
# orders-api ok
```

And the image itself declares how to start, so nobody has to remember:

```bash
docker inspect --format '{{.Config.Cmd}} {{.Config.Entrypoint}}' orders-api:v1
# must show your start command, not [python3] and not []
```

## Hints

### Hint 1 — Ask the container what it did

`docker ps` only lists running containers. Use `docker ps -a` and read the
`STATUS` column. What exit code do you see, and what does exit code `0` mean?

### Hint 2 — Every image has a default command

An image stores a default process to run. Inspect what your image inherited:

```bash
docker inspect --format '{{.Config.Cmd}}' orders-api:v1
docker inspect --format '{{.Config.Cmd}}' python:3.11-slim
```

They are the same. Your Dockerfile never said what to run, so the container ran
whatever `python:3.11-slim` runs by default. That is the Python interpreter, which
reads from standard input, immediately sees end-of-file, and exits cleanly.

### Hint 3 — EXPOSE is documentation, not plumbing

Even after the container stays up, check the second trap. `EXPOSE 8080` does not
publish anything to your host; it is metadata. The `-p` flag is what actually maps
a host port to a container port. Confirm you have both the process and the mapping.

## Solution

The Dockerfile never declares a start command, so the container inherits the base
image's default (`python3`), which exits immediately with status `0`.

Add a `CMD`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY app.py .

EXPOSE 8080

CMD ["python3", "app.py"]
```

Rebuild and run:

```bash
docker rm -f orders 2>/dev/null
docker build -t orders-api:v1 .
docker run -d --name orders -p 8080:8080 orders-api:v1
curl -s http://localhost:8080
```

Two details worth internalising:

- Use the **exec form** (`CMD ["python3", "app.py"]`), not the shell form
  (`CMD python3 app.py`). The shell form wraps your process in `/bin/sh -c`, which
  becomes PID 1 and does not forward `SIGTERM`. Your container then takes the full
  10 second kill timeout on every `docker stop`, and in Kubernetes every rolling
  update gets slower and less graceful.
- `CMD` versus `ENTRYPOINT`: `CMD` is a default that is easy to override
  (`docker run orders-api:v1 bash`). `ENTRYPOINT` fixes the executable and treats
  arguments as parameters to it. For an application image, `CMD` is the common choice.

## What You Learned

A successful `docker build` proves only that the filesystem was assembled. It says
nothing about whether the image knows how to run.

In real incidents this shows up as a deployment that reports success while serving
nothing, because the orchestrator started the container, the container exited `0`,
and "exited cleanly" is not an error anywhere in the toolchain. The habit to build
now is reflexive: when a container is missing, run `docker ps -a` and read the exit
code before you touch anything else.
