# Every CI build reinstalls every dependency

## Briefing

Local builds take eight seconds. The same build in CI takes eleven minutes, every
single time, including for a one-line README change.

The Dockerfile is well ordered — dependencies are copied and installed before the
application source, so caching should work. It does work locally. CI runners start from
nothing, and nothing is preserving the cache between runs.

## Your Task

- Reproduce a cold build by pruning your local cache, and measure it.
- Explain why correct layer ordering does not help a fresh runner.
- Make a second cold build reuse work from the first, using a cache the runner can
  fetch.
- Add a package-manager cache mount so even a genuine dependency change is fast.

## Starter Files

### file: requirements.txt

```text
requests==2.32.3
pyyaml==6.0.2
jinja2==3.1.4
```

### file: app.py

```python
print("service running")
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
CMD ["python", "app.py"]
```

### file: ci-build.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
docker build -t svc:ci .
echo "built"
```

## Expected Failure

Simulate a fresh runner:

```bash
docker builder prune -af >/dev/null
time bash ci-build.sh
```

```
#7 [3/5] RUN pip install --no-cache-dir -r requirements.txt
#7 24.31 Successfully installed ...
real    0m31.208s
```

Now change only the application source — the kind of change that should reuse
everything — but do it on a fresh runner again:

```bash
sed -i 's/service running/service running v2/' app.py
docker builder prune -af >/dev/null
time bash ci-build.sh
# real  0m30.914s        <- identical, nothing was reused
```

Layer ordering is correct and irrelevant. The cache is stored in the local build
daemon, and a CI runner is a new machine with an empty one every time.

## Expected Outcome

A cold runner must reuse work from a previous build.

**Populate a cache that outlives the runner:**

```bash
docker buildx build \
  --cache-to   type=local,dest=/tmp/bfcache,mode=max \
  --cache-from type=local,src=/tmp/bfcache \
  -t svc:ci --load .
```

**A subsequent cold build reuses it.** Wipe the local builder cache and rebuild:

```bash
docker builder prune -af >/dev/null
time docker buildx build --cache-from type=local,src=/tmp/bfcache -t svc:ci --load .
```

The dependency install must be reported as cached:

```
#7 [3/5] RUN pip install -r requirements.txt   CACHED
real    0m3.402s
```

and the elapsed time must be a small fraction of the cold build.

**A source-only change is still fast:**

```bash
sed -i 's/v2/v3/' app.py
docker builder prune -af >/dev/null
docker buildx build --cache-from type=local,src=/tmp/bfcache -t svc:ci --load . 2>&1 | grep 'pip install'
# CACHED
```

**A dependency change correctly invalidates the cache:**

```bash
echo "click==8.1.7" >> requirements.txt
docker buildx build --cache-from type=local,src=/tmp/bfcache -t svc:ci --load . 2>&1 | grep 'pip install'
# runs, not CACHED
```

**...but is still faster than a cold install**, because the package downloads are cached
by a mount:

```bash
# the second dependency change should be markedly quicker than the first cold build
```

**The final image does not contain the cache:**

```bash
docker run --rm svc:ci ls /root/.cache/pip 2>&1
# no such file or directory
```

## Hints

### Hint 1 — The layer cache lives on the builder, not in the image

`docker build` stores cached layers in the local BuildKit instance. A CI runner is
typically a fresh container or VM with an empty builder, so there is nothing to hit —
no matter how well your Dockerfile is ordered.

You have to export the cache somewhere the next runner can read it:

```bash
--cache-to   type=registry,ref=myrepo/svc:buildcache,mode=max
--cache-from type=registry,ref=myrepo/svc:buildcache
```

`type=local` writes to a directory (pair it with your CI's cache action);
`type=registry` pushes it as an image, which works across every runner without CI-specific
configuration; `type=gha` uses the GitHub Actions cache directly.

`mode=max` exports intermediate layers too, not just the final ones — which is what
makes multi-stage builds benefit.

### Hint 2 — Cache the package downloads as well

Layer caching is all-or-nothing: change one line in `requirements.txt` and the entire
install re-runs, downloading every package again.

A BuildKit cache mount persists a directory across builds without putting it in a layer:

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt
```

Note the removal of `--no-cache-dir` — you now *want* pip's cache, because the mount
keeps it out of the image while preserving it between builds. The same pattern applies
to `/var/cache/apt`, `~/.npm`, `~/.m2` and the Go build cache.

## Solution

The layer cache was local to a builder that CI throws away. Export it, and add a
package cache mount for the case where the layer cache legitimately misses.

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /srv

COPY requirements.txt .
# the pip download cache persists between builds and never enters a layer
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY app.py .
CMD ["python", "app.py"]
```

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-myrepo/svc}"
TAG="$(git rev-parse --short HEAD)"
CACHE="${IMAGE}:buildcache"

docker buildx build \
  --cache-from "type=registry,ref=${CACHE}" \
  --cache-to   "type=registry,ref=${CACHE},mode=max" \
  -t "${IMAGE}:${TAG}" \
  --push \
  .
```

In GitHub Actions, the native cache backend avoids needing a registry:

```yaml
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: myrepo/svc:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- **Layer ordering and cache availability are separate problems.** Ordering determines
  what *could* be reused; the cache backend determines whether anything *is* available
  to reuse. Local development hides the second problem completely.
- **`mode=max` for anything multi-stage.** The default `min` exports only the layers of
  the final image, so your build and test stages start cold every time — which is
  usually where most of the time goes.
- **Cache mounts are not layers.** They persist on the builder between builds and are
  never part of the image, which is why you can keep the package cache without paying
  for it in image size. On ephemeral runners they need `--cache-to` to survive, or a CI
  cache action mounting the BuildKit state.
- **Registry cache works everywhere.** It needs no CI-specific integration and is shared
  across runners, branches and developers, which also speeds up local cold builds.
- **Measure before optimising.** `--progress=plain` shows per-step durations, and `docker
  buildx build --print` explains the build graph. The expensive step is often not the one
  people assume.
