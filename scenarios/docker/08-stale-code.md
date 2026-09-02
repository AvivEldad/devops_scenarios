# You changed the code and the container runs the old version

## Briefing

You fixed a bug, rebuilt the image, and ran it. The old behaviour is still there. You
rebuild again. Same result.

The build output says `CACHED` next to several steps, which is normally good news.
Here it is telling you exactly what is wrong, and there is a second reason the old
code keeps running even after the image is correct.

## Your Task

- Build, run, change the code, rebuild, and reproduce the stale output.
- Identify which layer is being reused when it should not be.
- Find the second reason old code runs even with a correct image.
- Fix both without disabling the cache entirely.

## Starter Files

### file: app.py

```python
VERSION = "v1"
print(f"handler {VERSION}: returning 200")
```

### file: requirements.txt

```text
requests==2.32.3
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /srv

COPY . .
RUN pip install --no-cache-dir -r requirements.txt

CMD ["python", "app.py"]
```

### file: run.sh

```bash
#!/usr/bin/env bash
docker build -t handler:latest .
docker run -d --name handler handler:latest
docker logs handler
```

## Expected Failure

```bash
bash run.sh
# handler v1: returning 200

sed -i 's/VERSION = "v1"/VERSION = "v2"/' app.py
bash run.sh
```

```
docker: Error response from daemon: Conflict. The container name "/handler"
is already in use by container "8f2a...".
handler v1: returning 200
```

The old container was never replaced, so you are reading the old container's logs.
Remove it and try again:

```bash
docker rm -f handler && bash run.sh
# handler v2: returning 200
```

That works — but now make a change that *should* be cached differently and watch the
dependency install run again from scratch every single time:

```bash
sed -i 's/v2/v3/' app.py && time docker build -t handler:latest .
# pip install runs again, 20+ seconds, for a one-character code change
```

## Expected Outcome

A code change rebuilds fast, and the new code actually runs.

Dependency installation is cached across code changes:

```bash
sed -i 's/v3/v4/' app.py
docker build -t handler:latest . 2>&1 | grep -E 'CACHED.*pip|RUN pip'
# CACHED [3/5] RUN pip install --no-cache-dir -r requirements.txt
```

The build takes under a couple of seconds for a code-only change.

A dependency change **does** invalidate the cache, as it must:

```bash
echo "urllib3==2.2.2" >> requirements.txt
docker build -t handler:latest . 2>&1 | grep 'RUN pip'
# runs, not CACHED
```

The running container is the new one:

```bash
bash run.sh
docker logs handler
# handler v4: returning 200
```

Re-running the script repeatedly works without a name conflict:

```bash
bash run.sh && bash run.sh && bash run.sh
# succeeds every time
```

And you can confirm the container was actually recreated:

```bash
docker inspect handler --format '{{.Created}}'
# a timestamp from seconds ago
```

## Hints

### Hint 1 — Layer order determines what gets cached

```dockerfile
COPY . .
RUN pip install -r requirements.txt
```

Docker caches each instruction. When `COPY . .` changes — which it does on *every* code
edit — every instruction after it is invalidated, including the expensive install.

Reverse the dependency: copy only the manifest, install, then copy the source.

### Hint 2 — The container is not the image

`docker run` with an existing container name fails, and `docker logs` then shows you
the **old** container. An image rebuild does not touch running containers; you have to
replace them.

```bash
docker rm -f handler 2>/dev/null || true
docker run -d --name handler handler:latest
```

Also note `:latest` is just a tag. Retagging does not restart anything, and a container
started from the previous image keeps running the previous image forever.

## Solution

Two faults: the copy-before-install ordering destroys the dependency cache, and the run
script never replaced the existing container.

```dockerfile
FROM python:3.11-slim
WORKDIR /srv

# changes rarely: cached across every code edit
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# changes constantly: last, so it invalidates nothing expensive
COPY app.py .

CMD ["python", "app.py"]
```

```bash
#!/usr/bin/env bash
set -euo pipefail

TAG="handler:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"

docker build -t "$TAG" -t handler:latest .
docker rm -f handler 2>/dev/null || true
docker run -d --name handler "$TAG"
docker logs handler
```

- **Order layers from least to most frequently changed.** Base image, system packages,
  dependency manifests, dependency install, then application source. This one rule is
  most of what Dockerfile performance optimisation consists of.
- **`CACHED` in the build output is information, not just noise.** When you expect a
  step to re-run and it says `CACHED`, or vice versa, your layer ordering does not match
  your change pattern.
- **An image build does not affect running containers.** You must recreate them. In
  Kubernetes the same trap appears as a Deployment that does not restart because the
  tag did not change — which is why mutable tags like `:latest` cause so much confusion.
- **Tag with something immutable**, such as the commit SHA. Then "which version is
  running?" has an answer, and `docker run` cannot silently reuse a stale image.
- **`--no-cache` is a diagnostic, not a fix.** If you need it routinely, your layer
  ordering is wrong.
