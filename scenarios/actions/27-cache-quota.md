# The cache grew to 10 GB and every job missed

## Briefing

`actions/cache` has a size limit per key (~10 GB) and a total repo cache
quota. A job that caches `~/.cache` plus `node_modules` plus Docker layers
fails to save, or evicts the useful pip cache. Restore then misses; CI is
slow again. Saving on every failed run multiplies junk keys. Cache is not
an artifact store.

## Your Task

- Identify a cache `path:` that is unbounded (`/` or `~`).
- Narrow paths; split caches per tool; bump a key suffix to evict poison.
- Do not cache Docker images in `actions/cache` (use registry / buildx
  cache).

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cache
            /tmp
            node_modules
            ~/.docker
          key: ${{ runner.os }}-everything-${{ github.sha }}
      - run: npm ci && pytest
```

## Expected Failure

```text
Warning: Cache size of ~11000 MB exceeds 10 GB limit, skipping save
# or: Failed to save cache
# next run: Cache not found for key ...-everything-<new-sha>
```

`${{ github.sha }}` in the key means **never a hit** (unique every commit) —
the actions-02 bug plus size.

## Expected Outcome

Small, hashed, tool-specific caches that hit.

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: ${{ runner.os }}-pip-${{ hashFiles('requirements.txt') }}
```

Save succeeds; second run on the same lockfile restores.

## Hints

### Hint 1 — Unique sha in the key is a miss forever

Hash **inputs** (lockfiles), not the commit. SHA belongs in artifacts, not
cache keys.

### Hint 2 — Quota eviction is LRU-ish

Unused caches disappear. A 9 GB Docker cache will evict your 50 MB pip
cache. Keep caches small and separate.

## Solution

Split and hash lockfiles; drop Docker-from-cache.

```yaml
key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
path: ~/.npm
```

Use `docker/build-push-action` with `cache-from: type=gha`.

- **`enableCrossOsArchive`** is rarely what you want for native addons.
- **Failed jobs saving caches** of half-installs poison the next run — prefer
  save on success only (default) unless you know.
- **Self-hosted:** cache action uses GitHub cache API, not the runner disk,
  unless you configure otherwise. Disk can still fill (`/tmp`).
- **Monitor** cache usage in the Actions cache UI (org).
