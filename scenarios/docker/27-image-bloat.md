# The 1.2 GB image that should be 80 MB

## Briefing

A Python service image is 1.2 GB. The application is a few hundred lines. The image is
pulled hundreds of times a day across the fleet, and the size is now a measurable cost
in bandwidth, registry storage and pod startup time.

Nothing about the application requires a gigabyte. The size comes from build tools,
package caches, and files that never needed to be in the final image at all.

## Your Task

- Build the image and measure it.
- Attribute the size to specific layers rather than guessing.
- Rebuild it under 150 MB without changing what the application does.
- Verify the build toolchain is not present in the final image.

## Starter Files

### file: requirements.txt

```text
requests==2.32.3
cryptography==43.0.1
```

### file: app.py

```python
import requests
from cryptography.fernet import Fernet

key = Fernet.generate_key()
print(f"service ready, key length {len(key)}")
```

### file: Dockerfile

```dockerfile
FROM python:3.11

WORKDIR /app

COPY . .

RUN apt-get update \
 && apt-get install -y build-essential gcc git curl \
 && pip install -r requirements.txt

CMD ["python", "app.py"]
```

### file: .git-placeholder

```text
Pretend this directory also contains a large .git history, test fixtures,
and a 400 MB data/ directory that COPY . . pulls in.
```

## Expected Failure

```bash
docker build -t fat .
docker images fat --format '{{.Size}}'
# 1.24GB
```

Attribute it:

```bash
docker history fat --format '{{.Size}}\t{{.CreatedBy}}' | head -8
# 480MB   RUN apt-get install -y build-essential gcc git curl ...
# 310MB   FROM python:3.11              (the full, non-slim base)
# 220MB   RUN pip install ...           (includes build caches)
# 190MB   COPY . .                      (.git, data/, fixtures)
```

Four contributors: the full base image, a compiler toolchain kept in the final image,
pip's caches, and `COPY . .` dragging in everything in the directory.

## Expected Outcome

The image is small and contains only what runs.

Size is under 150 MB:

```bash
docker build -t slim .
docker images slim --format '{{.Size}}'
# ~130MB or less
```

The application still works:

```bash
docker run --rm slim
# service ready, key length 44
```

**No compiler or build tooling in the final image:**

```bash
docker run --rm slim sh -c 'command -v gcc git curl make 2>/dev/null; echo "---"'
# ---        (nothing found)
```

**No package-manager caches:**

```bash
docker run --rm slim sh -c 'ls /var/lib/apt/lists/ 2>/dev/null | wc -l; ls /root/.cache 2>/dev/null'
# 0
```

**No `.git` or excluded data in the image:**

```bash
docker run --rm slim sh -c 'ls -la /app/.git /app/data 2>&1 | head -1'
# no such file or directory
```

**Layer history shows no giant layers:**

```bash
docker history slim --format '{{.Size}}\t{{.CreatedBy}}' | sort -rh | head -3
# the largest layer is modest, not hundreds of MB
```

## Hints

### Hint 1 — `docker history` and `dive` tell you where the bytes are

```bash
docker history <image> --no-trunc
```

Never optimise by guessing. The history attributes size to each instruction, and `dive`
(`dive <image>`) shows exactly which files each layer adds and how much space is wasted.
Fix the largest contributors first.

### Hint 2 — Multi-stage: compile in one stage, ship another

Anything needed only to *build* — compilers, headers, git — should live in a build stage
and never reach the final image:

```dockerfile
FROM python:3.11 AS build
RUN pip install --prefix=/install -r requirements.txt

FROM python:3.11-slim
COPY --from=build /install /usr/local
```

The final stage starts from `-slim`, and only the installed packages cross over, not the
toolchain that produced them.

### Hint 3 — Stop copying what you do not ship

`COPY . .` pulls in `.git`, tests, fixtures and data. Add a `.dockerignore`:

```
.git
data/
tests/
*.md
__pycache__/
```

It also speeds up every build, because a smaller context uploads faster.

## Solution

Four independent size sources: the full base image, build tooling left in place, package
caches, and an unfiltered `COPY`.

```dockerfile
# ---- build stage: has the compiler, produces installed packages ----
FROM python:3.11-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- final stage: no compiler, no caches ----
FROM python:3.11-slim

WORKDIR /app
COPY --from=build /install /usr/local
COPY app.py .

CMD ["python", "app.py"]
```

```
# .dockerignore
.git
data/
tests/
*.md
__pycache__/
*.pyc
```

- **Measure, then attribute, then fix the biggest first.** `docker history` and `dive`
  turn image slimming from folklore into a targeted exercise. The order of impact is
  usually base image, then build tooling, then caches, then context.
- **Multi-stage builds are the single biggest lever.** Compilers and dev headers are
  frequently needed to install dependencies and never needed to run them; keeping them in
  a build stage removes hundreds of megabytes at a stroke.
- **`-slim` over the full base, and consider distroless** (`gcr.io/distroless/python3`)
  for the final stage, which has no shell or package manager and shrinks both size and
  attack surface. Alpine is smaller still but its musl libc can break Python wheels — a
  real trade-off, not a free win.
- **Combine and clean in one `RUN`.** `apt-get update && install && rm -rf
  /var/lib/apt/lists/*` in a single instruction; cleaning in a *separate* `RUN` leaves the
  cache in the earlier layer (the same "deleting doesn't shrink" rule as leaked secrets).
- **`--no-install-recommends` and `--no-cache-dir`** cut avoidable weight from apt and pip
  respectively.
- **A `.dockerignore` is mandatory, not optional.** `COPY . .` without one ships your git
  history and every stray file, and slows every build by uploading them to the daemon.
