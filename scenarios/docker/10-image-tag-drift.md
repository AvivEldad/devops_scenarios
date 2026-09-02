# Two machines, same tag, different behaviour

## Briefing

A bug reproduces on the staging server and not on your laptop. Both are running
`internal/report:latest`. Both were pulled this morning.

They are not the same image. The tag is a pointer, and it has moved.

## Your Task

- Build two different images under the same tag and observe that the tag alone tells
  you nothing.
- Determine which image a container is actually running, by digest.
- Make the deployment reference something that cannot drift.

## Starter Files

### file: app.py

```python
BUILD = "A"
print(f"report build {BUILD}")
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /srv
COPY app.py .
CMD ["python", "app.py"]
```

### file: deploy.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
docker build -t internal/report:latest .
docker rm -f report 2>/dev/null || true
docker run -d --name report internal/report:latest
echo "deployed internal/report:latest"
```

## Expected Failure

```bash
bash deploy.sh && docker logs report
# report build A
```

Someone else changes the code and deploys, without changing the tag:

```bash
sed -i 's/BUILD = "A"/BUILD = "B"/' app.py
bash deploy.sh && docker logs report
# report build B
```

Now `internal/report:latest` means something different than it did five minutes ago,
and nothing recorded the change. Ask what is running and the answer is useless:

```bash
docker inspect report --format '{{.Config.Image}}'
# internal/report:latest
```

That string was equally true of build A. There is no way to tell from it which code is
in production, and no way to roll back to "the one from before".

## Expected Outcome

Every deployment references an immutable identifier.

The deploy tags by content, not just `latest`:

```bash
bash deploy.sh
docker inspect report --format '{{.Config.Image}}'
# internal/report:a1b2c3d      (or a digest)
```

You can determine exactly which image a running container uses:

```bash
docker inspect report --format '{{.Image}}'
# sha256:9f8e7d6c...           <- immutable, unambiguous
```

Two builds produce two distinguishable tags:

```bash
docker images internal/report --format '{{.Tag}}\t{{.ID}}'
# a1b2c3d   9f8e7d6c...
# e4f5g6h   1a2b3c4d...
# latest    1a2b3c4d...        <- latest is an alias for the newest
```

Rollback is possible by name:

```bash
docker rm -f report
docker run -d --name report internal/report:a1b2c3d
docker logs report
# report build A               <- the previous build, recovered
```

And a pull by digest is verifiable:

```bash
docker inspect internal/report:latest --format '{{.Id}}'
# matches the digest you deployed
```

Clean up: `docker rm -f report`

## Hints

### Hint 1 — A tag is a mutable pointer

`:latest` is not special to Docker in any way. It is the default tag name and nothing
more — it does not mean newest, and it carries no guarantee.

Any tag can be moved to point at a different image at any time. Two hosts that pulled
`:latest` at different moments have different images with identical names.

The immutable identifier is the **digest**: `sha256:...`, derived from the image
content. `docker inspect --format '{{.Image}}'` gives you the digest of what a
container is running.

### Hint 2 — Tag with something that identifies the source

```bash
TAG="$(git rev-parse --short HEAD)"
docker build -t "internal/report:${TAG}" -t internal/report:latest .
docker run -d --name report "internal/report:${TAG}"
```

Now the running container names the commit that produced it. Keep pushing `:latest` as
a convenience alias if you like, but never deploy from it.

For maximum strictness, deploy by digest:
`docker run internal/report@sha256:9f8e...`, which cannot be repointed by anyone.

## Solution

The tag was mutable, so it identified nothing.

```bash
#!/usr/bin/env bash
set -euo pipefail

TAG="$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
IMAGE="internal/report:${TAG}"

docker build -t "$IMAGE" -t internal/report:latest .

docker rm -f report 2>/dev/null || true
docker run -d --name report "$IMAGE"

DIGEST="$(docker inspect report --format '{{.Image}}')"
echo "deployed ${IMAGE}"
echo "digest   ${DIGEST}"
```

- **Tags are pointers; digests are identities.** Every question that matters — what is
  running, what changed, what do I roll back to — needs an identity, and a tag cannot
  provide one.
- **Deploy by immutable tag or digest, use `:latest` only for local convenience.** The
  same rule applies to base images: `FROM python:3.11-slim` will change underneath you,
  and `FROM python@sha256:...` will not.
- **`imagePullPolicy: Always` with a mutable tag** is the Kubernetes version of this
  problem, and it means two pods in one ReplicaSet can run different code.
- **Record the digest at deploy time.** When someone asks what was running during last
  Tuesday's incident, a digest in the deploy log answers it and a tag does not.
- **Registry tag immutability** is available in most registries (ECR, GHCR, Harbor) and
  is worth enabling: it makes overwriting a published tag an error rather than a
  routine accident.
