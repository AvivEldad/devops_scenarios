# The layer cache poisoned by `apt-get update`

## Briefing

A Dockerfile installs packages with the standard two-command apt pattern, split across
two `RUN` instructions for "readability". A month later, a build on a CI runner installs
a package version that no longer exists in the index, and fails. On another runner it
silently installs a stale, months-old version with a known CVE.

The cause is layer caching interacting with `apt-get update` in a way that is subtle,
well documented, and still everywhere. There is also a reproducibility problem hiding
next to it.

## Your Task

- Build the image, change an unrelated line, and rebuild.
- Explain why the package index is now stale while the install step re-runs.
- Fix the caching interaction so update and install cannot desynchronise.
- Address the reproducibility problem so two builds a month apart install the same
  versions.

## Starter Files

### file: Dockerfile

```dockerfile
FROM debian:12-slim

# split "for readability" - this is the bug
RUN apt-get update

RUN apt-get install -y curl ca-certificates

COPY app.sh /app.sh
RUN chmod +x /app.sh

CMD ["/app.sh"]
```

### file: app.sh

```bash
#!/usr/bin/env bash
echo "app running"
curl --version | head -1
```

## Expected Failure

```bash
docker build -t apt-demo .
```

It builds. Now change the app and rebuild:

```bash
sed -i 's/app running/app running v2/' app.sh
docker build -t apt-demo .
```

```
 => CACHED [2/5] RUN apt-get update
 => CACHED [3/5] RUN apt-get install -y curl ca-certificates
 => [4/5] COPY app.sh /app.sh
```

Both apt steps are `CACHED`. That is the trap. The `apt-get update` layer is frozen at
the moment it first ran — its cached package index can be weeks old. When the install
step later misses the cache (because you added a package, say), it runs `apt-get install`
against that *stale* index and either fails to find a current version or installs an
outdated one.

Demonstrate the desync directly:

```bash
# add a package -> install step re-runs, but update stays CACHED
sed -i 's/curl ca-certificates/curl ca-certificates jq/' Dockerfile
docker build -t apt-demo .
#  => CACHED [2/5] RUN apt-get update              <- stale index
#  => [3/5] RUN apt-get install -y curl ... jq     <- runs against it
# ...may fail with: Unable to locate package / Version '...' not found
```

## Expected Outcome

Update and install always run together, and versions are reproducible.

**The two apt commands are in one layer**, so they can never desynchronise:

```bash
docker history apt-demo --format '{{.CreatedBy}}' | grep -c 'apt-get update.*apt-get install'
# 1        <- update and install in the same RUN
```

**Adding a package re-runs the update too:**

```bash
docker build -t apt-demo . 2>&1 | grep -A1 'apt-get update'
# not CACHED when the install list changed
```

**No apt cache is left in the image:**

```bash
docker run --rm apt-demo ls /var/lib/apt/lists/ | wc -l
# 0
```

**The application works:**

```bash
docker run --rm apt-demo
# app running v2
# curl 7.88.1 ...
```

**Versions are pinned, so a rebuild installs the same version:**

```bash
docker run --rm apt-demo sh -c 'dpkg -s curl | grep Version'
# Version: 7.88.1-10+deb12u...    <- an exact, recorded version
```

**The base image is pinned by digest**, so the foundation cannot shift underneath:

```bash
grep '^FROM' Dockerfile
# FROM debian:12-slim@sha256:...
```

## Hints

### Hint 1 — `update` and `install` must share a layer

Docker caches each `RUN` independently. When `apt-get update` is its own instruction,
its layer — containing the downloaded package index — is cached and reused even when the
install step changes. The install then runs against an index that may be weeks stale.

Put them in one `RUN` so they are cached and invalidated as a unit:

```dockerfile
RUN apt-get update && apt-get install -y curl ca-certificates
```

Now any change to the package list re-runs the update as well, and the index is always
consistent with the install.

### Hint 2 — Clean the cache in the same layer, and pin versions

Two more parts of the canonical pattern:

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl=7.88.1-10+deb12u5 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*
```

- `rm -rf /var/lib/apt/lists/*` in the *same* `RUN` keeps the index out of the image (in
  a later `RUN` it would already be baked into the earlier layer).
- `pkg=version` pins exact versions so a rebuild is reproducible.
- Pin the base image by digest (`FROM debian:12-slim@sha256:...`) so `12-slim` moving does
  not change your foundation.

## Solution

`apt-get update` in a separate, cacheable layer desynchronised from the install. Combine
them, clean in place, pin versions, and pin the base.

```dockerfile
FROM debian:12-slim@sha256:2f8...   # pin the exact base image

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY app.sh /app.sh
RUN chmod +x /app.sh

CMD ["/app.sh"]
```

For genuinely reproducible builds, pin package versions explicitly (discover the current
version with `apt-cache policy curl` inside the base image):

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl=7.88.1-10+deb12u5 \
      ca-certificates=20230311 \
 && rm -rf /var/lib/apt/lists/*
```

And for build speed without sacrificing correctness, a BuildKit cache mount keeps the
downloaded packages between builds while still refreshing the index each time:

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates
```

- **`apt-get update` alone in a `RUN` is a caching bug, not a style choice.** Its layer
  freezes the package index, and a later cache miss on the install runs against that stale
  index. Always combine update and install in one instruction.
- **This is why builds "suddenly" fail or install old packages.** The index went stale
  weeks ago; the failure only surfaced when something invalidated the install layer. The
  cause and the symptom are far apart in time, which makes it hard to diagnose without
  knowing the pattern.
- **Clean the cache in the same layer.** `rm -rf /var/lib/apt/lists/*` in a separate `RUN`
  does nothing for image size — the same append-only rule as leaked secrets.
- **Pin for reproducibility at every level**: base image by digest, packages by version.
  An unpinned build is not a build you can reproduce, which matters the day you need to
  rebuild last quarter's release to patch it.
- **`--no-install-recommends`** avoids pulling in a long tail of suggested packages,
  cutting both size and the number of moving versions.
- **Cache mounts give you speed and freshness together**, which the plain combined `RUN`
  trades off — the index refreshes every build while the downloads persist.
