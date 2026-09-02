# The image built on a laptop will not run on the server

## Briefing

An image built on an Apple Silicon laptop is pushed to the registry. On the Linux
build servers it fails to start with `exec format error`.

Another developer reports the opposite: the image runs, but roughly twenty times
slower than expected, with no error at all. That case is worse, because nothing
signals a problem.

## Your Task

- Build an image for a foreign architecture and reproduce the failure.
- Determine the architecture of an image and of your host.
- Produce an image that runs correctly on both `linux/amd64` and `linux/arm64`.

> `docker buildx` is included with current Docker Desktop and Docker Engine. QEMU
> emulation for cross-platform builds may need
> `docker run --privileged --rm tonistiigi/binfmt --install all`.

## Starter Files

### file: app.py

```python
import platform

print(f"running on {platform.machine()} ({platform.system()})")
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /srv
COPY app.py .
CMD ["python", "app.py"]
```

### file: build.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
docker build -t svc:local .
echo "built svc:local"
```

## Expected Failure

Build for the architecture you are *not* on. On an x86 machine:

```bash
docker build --platform linux/arm64 -t svc:arm64 .
docker run --rm svc:arm64
```

```
exec /usr/local/bin/python: exec format error
```

Or, if QEMU emulation is installed, it runs — very slowly — and gives no indication
that anything is unusual:

```bash
time docker run --rm svc:arm64
# running on aarch64 (Linux)
# real  0m4.213s       <- against ~0.3s native
```

Inspect the image and the mismatch is explicit:

```bash
docker image inspect svc:arm64 --format '{{.Os}}/{{.Architecture}}'
# linux/arm64
uname -m
# x86_64
```

## Expected Outcome

One image reference works correctly on both architectures.

The native build reports your own architecture and starts instantly:

```bash
docker run --rm svc:local
# running on x86_64 (Linux)      (or aarch64 on Apple Silicon)
```

A multi-architecture image exists with both platforms in its manifest:

```bash
docker buildx imagetools inspect svc:multi
# Manifests:
#   Platform: linux/amd64
#   Platform: linux/arm64
```

or when building locally to a tarball:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t svc:multi \
  --output type=oci,dest=svc-multi.tar .
tar -xOf svc-multi.tar index.json | python3 -m json.tool | grep architecture
# "architecture": "amd64"
# "architecture": "arm64"
```

Pulling the multi-arch reference selects the right variant automatically:

```bash
docker image inspect svc:multi --format '{{.Architecture}}'
# matches your host: amd64 on x86_64, arm64 on Apple Silicon
```

The build script warns rather than silently producing a single-architecture image:

```bash
bash build.sh
# builds for the requested platforms, and states which
```

## Hints

### Hint 1 — `exec format error` means wrong CPU architecture

The kernel loaded the binary and could not interpret its instruction format. It is the
same error you get running an ARM binary on x86 outside a container.

Establish what you have:

```bash
uname -m                                              # host
docker image inspect <img> --format '{{.Architecture}}'   # image
docker version --format '{{.Server.Arch}}'            # daemon
```

The default `docker build` targets the host architecture, so an image built on Apple
Silicon is `arm64` unless you say otherwise. That is the whole cause.

### Hint 2 — Build for all target platforms with buildx

```bash
docker buildx create --use --name multi 2>/dev/null || docker buildx use multi
docker buildx build --platform linux/amd64,linux/arm64 -t registry/svc:1.0 --push .
```

This produces a **manifest list**: one tag containing several images, one per platform.
Docker picks the matching one automatically at pull time.

Multi-platform images cannot be loaded into the local daemon with `--load` (which
handles a single platform only) — you push them to a registry, or export with
`--output type=oci`.

## Solution

The image was built for the host's architecture and run on a different one. The silent
case is worse than the loud one: QEMU emulation makes it work, slowly, with no warning.

Build a manifest list covering every target:

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-svc}"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
PLATFORMS="linux/amd64,linux/arm64"

docker buildx create --use --name multi 2>/dev/null || docker buildx use multi

echo "building ${IMAGE}:${TAG} for ${PLATFORMS}"
docker buildx build \
  --platform "$PLATFORMS" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  --push \
  .

docker buildx imagetools inspect "${IMAGE}:${TAG}"
```

For Dockerfiles that need to know their target, BuildKit provides automatic arguments:

```dockerfile
FROM --platform=$BUILDPLATFORM python:3.11-slim AS build
ARG TARGETPLATFORM
ARG TARGETARCH
RUN echo "building for $TARGETPLATFORM (arch $TARGETARCH)"

FROM python:3.11-slim
WORKDIR /srv
COPY app.py .
CMD ["python", "app.py"]
```

- **`exec format error` is always an architecture mismatch.** Check the image
  architecture and the host architecture; the answer is immediate.
- **The silent case is the dangerous one.** With QEMU installed, a foreign-architecture
  image runs under emulation at a large performance cost and reports nothing. A CI job
  that mysteriously takes ten times longer than it should is often this.
- **Build for the platforms you deploy to, not the one you develop on.** A team split
  between Apple Silicon laptops and x86 servers needs multi-arch builds as a matter of
  course.
- **Multi-arch matters for base images too.** Not every image on Docker Hub publishes
  `arm64`, and pinning by digest pins to one specific platform — pin by tag if you need
  the manifest list, and by digest only when you have chosen a platform deliberately.
- **`--platform` on `docker run`** forces a specific variant from a manifest list, which
  is useful for reproducing a colleague's problem on your own machine.
