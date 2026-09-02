# The secret you deleted is still in the image

## Briefing

A private key was copied into an image to clone a private repository, then removed in a
later instruction. The final image has no such file — `ls` proves it.

Security scanned the published image and extracted the key in under a minute.

Deleting a file in a later layer does not remove it from the image. It only hides it.

## Your Task

- Build the image and confirm the file is absent from the running container.
- Extract the secret from the image anyway.
- Rebuild so the secret is genuinely not recoverable, while still being usable during
  the build.
- Verify by extracting again and finding nothing.

## Starter Files

### file: Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /srv

# a deploy key, needed to fetch a private dependency during the build
COPY deploy_key.pem /root/.ssh/id_rsa
RUN echo "using key to fetch private dependency..." \
 && sha256sum /root/.ssh/id_rsa

# "cleaned up" afterwards
RUN rm -f /root/.ssh/id_rsa

COPY app.py .
CMD ["python", "app.py"]
```

### file: app.py

```python
print("service running")
```

### file: make-key.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
cat > deploy_key.pem <<'EOF'
-----BEGIN OPENSSH PRIVATE KEY-----
NOT-A-REAL-KEY-BUT-TREAT-IT-AS-ONE-abc123def456ghi789
-----END OPENSSH PRIVATE KEY-----
EOF
echo "wrote deploy_key.pem"
```

## Expected Failure

```bash
bash make-key.sh
docker build -t leaky .
```

The file is definitely gone from the final filesystem:

```bash
docker run --rm leaky ls -la /root/.ssh/
# ls: cannot access '/root/.ssh/': No such file or directory
```

Now extract it from the image anyway:

```bash
docker save leaky -o leaky.tar
mkdir -p unpacked && tar -xf leaky.tar -C unpacked
grep -rl 'BEGIN OPENSSH PRIVATE KEY' unpacked/ 2>/dev/null | head -3
```

```
unpacked/blobs/sha256/3f9a1c...
```

```bash
tar -xOf leaky.tar 2>/dev/null | grep -a 'NOT-A-REAL-KEY'
# NOT-A-REAL-KEY-BUT-TREAT-IT-AS-ONE-abc123def456ghi789
```

The build history announces it too:

```bash
docker history leaky --no-trunc | grep -i 'deploy_key\|id_rsa'
# COPY deploy_key.pem /root/.ssh/id_rsa
```

An image is a stack of layers. The `rm` created a new layer containing a deletion
marker. Every earlier layer, including the one holding the key, is still present and
distributed with the image.

## Expected Outcome

The secret must be usable during the build and unrecoverable from the result.

The build still works and can use the key:

```bash
docker build --secret id=deploykey,src=deploy_key.pem -t clean .
# the build step that needs the key succeeds
```

The image runs:

```bash
docker run --rm clean
# service running
```

**The key cannot be extracted from any layer:**

```bash
docker save clean -o clean.tar
tar -xOf clean.tar 2>/dev/null | grep -a 'NOT-A-REAL-KEY' && echo "LEAKED" || echo "clean"
# clean
```

**The build history does not reference it:**

```bash
docker history clean --no-trunc | grep -iE 'deploy_key|id_rsa|BEGIN OPENSSH'
# (no output)
```

**The image configuration is clean too:**

```bash
docker inspect clean --format '{{json .Config}}' | grep -ic 'key\|secret'
# 0
```

**And a layer-by-layer search finds nothing:**

```bash
for blob in $(tar -tf clean.tar | grep blobs/sha256); do
  tar -xOf clean.tar "$blob" 2>/dev/null | grep -aq 'NOT-A-REAL-KEY' && echo "found in $blob"
done
echo "scan complete"
# scan complete, with no findings
```

Clean up: `rm -rf leaky.tar clean.tar unpacked deploy_key.pem`

## Hints

### Hint 1 — Layers are append-only

Each instruction produces a layer, and the image is all of them stacked. Deleting a file
adds a *whiteout* entry in a new layer that hides the file from the merged view. The
bytes in the earlier layer are untouched and ship with the image.

The same applies to `--build-arg`: values are recorded in the image metadata and shown
by `docker history`, so passing a token that way leaks it just as effectively.

```bash
docker history <image> --no-trunc
docker save <image> | tar -tv
```

### Hint 2 — BuildKit secrets never enter a layer

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=deploykey,target=/root/.ssh/id_rsa \
    sh -c 'sha256sum /root/.ssh/id_rsa'
```

```bash
docker build --secret id=deploykey,src=deploy_key.pem -t clean .
```

The file is mounted into that one instruction and does not exist before or after it. It
is not written to any layer and does not appear in the history.

There is also `--mount=type=ssh` for forwarding an SSH agent, which is the cleanest way
to clone a private repository during a build without any key file at all.

## Solution

Deleting a file in a later layer hides it; it does not remove it. Use a BuildKit secret
so the value is never written to a layer.

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /srv

# the key is mounted for this instruction only and leaves no trace
RUN --mount=type=secret,id=deploykey,target=/root/.ssh/id_rsa,mode=0400 \
    echo "using key to fetch private dependency..." \
 && sha256sum /root/.ssh/id_rsa

COPY app.py .
CMD ["python", "app.py"]
```

```bash
DOCKER_BUILDKIT=1 docker build \
  --secret id=deploykey,src=deploy_key.pem \
  -t clean .
```

For cloning a private repository, forward the agent instead of handling a key file:

```dockerfile
RUN --mount=type=ssh \
    git clone git@github.com:org/private-dep.git /tmp/dep
```

```bash
docker build --ssh default -t clean .
```

- **An image is an append-only stack.** `rm`, `truncate` and `shred` in a later
  instruction change the merged view and nothing else. Anyone with the image has every
  layer.
- **Multi-stage builds are the other correct answer.** Do the secret-consuming work in a
  build stage and `COPY --from=build` only the artefacts into a clean final stage. The
  build stage's layers are not part of the published image.
- **`--build-arg` is not a secret mechanism.** Values appear in `docker history` and in
  the image config. This is one of the most common ways tokens reach public registries.
- **`--squash` is not a fix either.** It is experimental, it discards your layer caching,
  and it does not address `docker history` or build arguments. Reach for BuildKit
  secrets or multi-stage instead.
- **Rotate, do not just rebuild.** If a secret was ever in a published image, treat it as
  compromised. Removing the image from the registry does not un-distribute it, and layer
  caches on build agents and mirrors may retain it for a long time.
- **Scan for this in CI.** Tools such as `trivy image --scanners secret` and `dive` will
  find credentials in layers, and are worth running on every published image.
