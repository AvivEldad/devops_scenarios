# Multi-stage build that ships a 900 MB root container

## Briefing

The image scanner blocked your team's release with three findings on `reports-api`:

- the container runs as `root`
- the image is close to a gigabyte for an application that is 40 lines long
- every single code change triggers a full dependency reinstall, so CI takes six
  minutes to rebuild a one-character fix

Your manager wants all three fixed today, and the application code is owned by
another team, so you may not touch `app.py` or `requirements.txt`.

> This scenario needs network access during the build because `pip` downloads Flask.

## Your Task

Save the starter files, build the image as `reports-api:slim`, and get it under the
limits below without changing application behaviour.

| Requirement | Target |
|---|---|
| Image size | under 250 MB |
| Runtime user | any non-root UID |
| Rebuild after a code-only change | under 10 seconds, no `pip install` re-run |
| Build context sent to the daemon | under 100 kB |
| Health | container reports `healthy` on its own |

```bash
mkdir -p ~/breakfix/docker-03 && cd ~/breakfix/docker-03
```

To make the build context realistic, create some junk that has no business being in
an image:

```bash
mkdir -p .git/objects venv/lib node_modules
dd if=/dev/urandom of=.git/objects/pack.bin bs=1M count=25 2>/dev/null
dd if=/dev/urandom of=venv/lib/big.so bs=1M count=25 2>/dev/null
echo "AWS_SECRET_ACCESS_KEY=not-a-real-key" > .env
```

## Starter Files

### file: app.py

```python
from flask import Flask
import os
import socket

app = Flask(__name__)


@app.get("/")
def index():
    return {"service": "reports-api", "host": socket.gethostname()}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
```

### file: requirements.txt

```text
flask==3.0.3
```

### file: Dockerfile

```dockerfile
FROM python:3.11

RUN apt-get update && apt-get install -y \
      build-essential \
      curl \
      git \
      vim \
      net-tools

WORKDIR /app

COPY . .

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8080

CMD ["python", "app.py"]
```

## Expected Failure

Nothing errors. That is why this survived code review.

```bash
docker build -t reports-api:fat .
docker image ls reports-api:fat --format '{{.Size}}'
# roughly 900MB - 1.1GB

docker run --rm reports-api:fat id -u
# 0        -> root

echo "# touch" >> app.py
time docker build -t reports-api:fat .
# re-runs apt-get and pip; minutes, not seconds
```

Watch the first line of the build output as well. It reports the build context size,
and it includes your `.git`, `venv`, `node_modules` and `.env` — meaning your secret
file is now inside the image layers:

```bash
docker run --rm reports-api:fat cat /app/.env
# AWS_SECRET_ACCESS_KEY=not-a-real-key
```

## Expected Outcome

Build as `reports-api:slim` and verify each requirement.

Size is under 250 MB:

```bash
docker image ls reports-api:slim --format '{{.Repository}}:{{.Tag}} {{.Size}}'
```

The process is not root:

```bash
docker run --rm reports-api:slim id -u
# any non-zero UID, for example 10001
```

Secrets and build junk are gone:

```bash
docker run --rm reports-api:slim ls -a /app
# no .env, no .git, no venv, no node_modules
```

Dependency layer survives a code change:

```bash
echo "# touch" >> app.py
time docker build -t reports-api:slim .
# completes in seconds; the pip layer shows CACHED
```

It runs and reports its own health:

```bash
docker run -d --name reports -p 8080:8080 reports-api:slim
sleep 15
docker inspect --format '{{.State.Health.Status}}' reports
# healthy
curl -s http://localhost:8080/healthz
# {"status":"ok"}
```

## Hints

### Hint 1 — Order your layers by how often they change

Docker caches each instruction and invalidates every layer after the first change.
`COPY . .` before `pip install` means any edit to any file busts the dependency layer.

Copy only the dependency manifest first, install, and copy the source afterwards:

```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
```

### Hint 2 — Stop shipping the toolchain

`python:3.11` is the full Debian image, roughly 1 GB before you add anything, and
`build-essential`, `git` and `vim` are build-time or debugging tools that have no
role at runtime. Look at `python:3.11-slim`.

For a true multi-stage build, install into a prefix in a builder stage and copy just
that directory into a clean runtime stage:

```dockerfile
FROM python:3.11-slim AS builder
COPY requirements.txt .
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
COPY --from=builder /install /usr/local
```

Only the second stage becomes your final image. Everything in `builder` is discarded.

### Hint 3 — The build context is a separate problem

Layer ordering does not stop Docker from uploading `.git` and `venv` to the daemon,
and `COPY . .` will still bake them in. That is what `.dockerignore` is for. Write
one, then rebuild and compare the reported context size.

### Hint 4 — Non-root is two steps, not one

Creating a user is not enough; you have to switch to it, and the switch must come
after any step that needs write access. Also make sure the runtime user can read the
application directory.

```dockerfile
RUN useradd --uid 10001 --create-home appuser
USER 10001
```

`HEALTHCHECK` needs a tool that exists in the final image. `curl` is not in the slim
image, and installing it just for a health check adds weight — Python is already
there, so use it.

## Solution

Four separate problems: the base image, the layer order, the build context, and the
runtime user.

### The `.dockerignore`

```text
.git
.gitignore
venv
node_modules
__pycache__
*.pyc
.env
*.md
Dockerfile
.dockerignore
```

### The rewritten Dockerfile

```dockerfile
# ---- build stage: compile and collect dependencies ----
FROM python:3.11-slim AS builder

WORKDIR /build

# dependency manifest first, so this layer is cached across code changes
COPY requirements.txt .
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt

# ---- runtime stage: only what is needed to serve traffic ----
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --chown=10001:10001 app.py .

USER 10001

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz').status==200 else 1)"

CMD ["python3", "app.py"]
```

Build and verify:

```bash
docker build -t reports-api:slim .
docker image ls reports-api:slim --format '{{.Size}}'
docker run --rm reports-api:slim id -u
```

Why each change matters:

- **`python:3.11-slim`** drops roughly 700 MB of Debian userland you never execute.
- **The builder stage** means `pip`'s build dependencies never reach the final image.
- **`COPY requirements.txt` before the source** keeps the expensive install layer
  cached; only the cheap `COPY app.py` layer rebuilds on a code change.
- **`.dockerignore`** shrinks the upload and, more importantly, stops `.env` from
  being baked into a layer. Note that if a secret was ever committed into a layer,
  deleting it in a later layer does **not** remove it — the earlier layer still
  contains it. You must rebuild.
- **`USER 10001`** means a container escape starts as an unprivileged user. Use a
  numeric UID so Kubernetes `runAsNonRoot` can verify it without resolving names.
- **`PYTHONUNBUFFERED=1`** makes logs appear immediately instead of being buffered
  until the process exits, which matters enormously when you are debugging a crash.

For production you would also pin the base image by digest
(`python:3.11-slim@sha256:...`) so that `3.11-slim` moving underneath you cannot
silently change your build.

## What You Learned

Nothing here was an error; it was four defaults left in place. That is what most
real image hardening looks like — no bug to find, just accumulated carelessness that
a scanner eventually turns into a release blocker.

The two ideas worth carrying into every Dockerfile you touch: order instructions
from least-frequently-changed to most-frequently-changed, and treat the final stage
as an allow-list of what production genuinely needs rather than a leftover of how
you built it.
