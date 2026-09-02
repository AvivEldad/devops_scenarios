# The cache that never hits and the secret that is not there

## Briefing

Two complaints about the same workflow.

The platform team added dependency caching last month to speed up CI. Build times did
not change. The cache step reports `Cache saved` on every run and `Cache not found`
on the next one, which everyone has assumed is normal.

Separately, pull requests from an outside contributor fail on the deploy-preview step
with an empty credential, while the identical step works fine for maintainers. The
current theory is that the contributor's fork "has permissions problems".

Neither is mysterious. The cache key is wrong in a specific and instructive way, and
the secret behaviour is a deliberate GitHub security boundary that the workflow is
built to ignore.

> Needs a GitHub repository. To reproduce the fork behaviour fully you need a second
> account or a collaborator, but you can observe the mechanism without one.

## Your Task

1. Reproduce both problems: run the workflow twice and show the cache never hits;
   inspect the secret handling and explain when it will be empty.
2. Fix the cache so a second run with unchanged dependencies restores it.
3. Fix the secret handling so the workflow behaves correctly and safely for both
   trusted and untrusted pull requests.
4. Make the workflow fail loudly when a required secret is missing, instead of
   proceeding with an empty value.

## Starter Files

### file: .github/workflows/ci.yaml

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Cache dependencies
        uses: actions/cache@v4
        with:
          path: .venv
          key: deps-${{ github.run_id }}

      - name: Install
        run: |
          python -m venv .venv
          .venv/bin/pip install -r requirements.txt

      - name: Test
        run: .venv/bin/pytest tests/ -q

  deploy-preview:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Publish preview
        run: |
          echo "publishing preview for PR #${{ github.event.number }}"
          curl -sS -X POST \
            -H "Authorization: Bearer ${{ secrets.PREVIEW_TOKEN }}" \
            -d "ref=${{ github.head_ref }}" \
            https://preview.example.com/api/deploy
```

### file: requirements.txt

```text
pytest==8.2.0
requests==2.32.3
```

### file: tests/test_smoke.py

```python
def test_smoke():
    assert True
```

## Expected Failure

### Problem 1: the cache never hits

Run the workflow twice without changing anything:

```bash
git commit --allow-empty -m "run 1" && git push
gh run watch
git commit --allow-empty -m "run 2" && git push
gh run watch
```

Both runs log the same thing:

```
Cache not found for input keys: deps-11234567890
...
Cache saved with key: deps-11234567890
```

The key contains `github.run_id`, which is unique to every run. The workflow saves a
cache under a key that can never be requested again. You are paying the cost of
uploading a cache on every run and getting nothing back — slightly *slower* than no
caching at all.

Check the storage filling up:

```bash
gh cache list
# dozens of entries, one per run, all unused
```

### Problem 2: the secret is empty on fork pull requests

For a pull request from a fork, the deploy step runs with an empty token:

```
publishing preview for PR #42
curl: HTTP 401 Unauthorized
```

The step does not fail on the empty secret — it substitutes an empty string and sends
a request with `Authorization: Bearer `, which the API rejects with an error that
points at the wrong thing entirely.

## Expected Outcome

The cache must restore, and secret handling must be correct and explicit.

**Cache hits on the second run.** Two runs with unchanged `requirements.txt`:

```bash
gh run view --log | grep -i 'cache restored'
# Cache restored from key: deps-Linux-py3.11-<hash>
```

The install step is measurably faster or skipped entirely.

**Changing a dependency invalidates the cache.** Edit `requirements.txt`, push, and
confirm a miss followed by a save under a new key:

```bash
# after bumping requests to 2.32.4
gh run view --log | grep -iE 'cache (not found|saved)'
# Cache not found for input keys: deps-Linux-py3.11-<new-hash>
# Cache saved with key: deps-Linux-py3.11-<new-hash>
```

**Cache keys are bounded in number.** One key per dependency-set per runner per Python
version, not one per run:

```bash
gh cache list
# a small, stable set of entries
```

**A missing secret fails the job with a clear message**, rather than sending an empty
credential:

```
Error: PREVIEW_TOKEN is not available for this run.
Preview deployments are skipped for pull requests from forks.
```

and the job result must be either a clean skip or an explicit failure — never a 401
from a downstream service.

**Fork pull requests still run tests.** This is the important part: security must not
break CI for contributors.

```bash
# on a fork PR
gh run list --limit 1
# the "test" job runs and passes; "deploy-preview" is skipped
```

**Maintainer pull requests get a preview.** On a branch in the main repository, the
deploy job runs with a real token and succeeds.

## Hints

### Hint 1 — A cache key must describe the content, not the run

The purpose of a key is to identify *what is in the cache*, so a later run with the
same inputs can find it. `github.run_id` is unique per run, so the key is never
repeated and a hit is impossible by construction.

Key on a hash of the dependency manifest:

```yaml
key: deps-${{ runner.os }}-py3.11-${{ hashFiles('requirements.txt') }}
```

Now the key changes exactly when the dependencies change, which is the behaviour you
want. Include `runner.os` and the language version because a virtualenv built on one
is not valid on another.

### Hint 2 — `restore-keys` gives you a partial hit

When dependencies change, an exact miss does not have to mean starting from nothing:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: deps-${{ runner.os }}-py3.11-${{ hashFiles('requirements.txt') }}
    restore-keys: |
      deps-${{ runner.os }}-py3.11-
      deps-${{ runner.os }}-
```

`restore-keys` are prefix matches, tried in order, using the most recent match. You get
the previous cache as a starting point and only download what changed.

Also reconsider *what* you are caching. Caching `.venv` bakes in absolute paths and is
fragile; caching the pip download cache (`~/.cache/pip`) is more portable. Better yet,
`actions/setup-python` has `cache: pip` built in and handles the key for you.

### Hint 3 — Secrets are withheld from fork pull requests on purpose

This is not a bug and not a permissions misconfiguration. When a pull request comes
from a fork, GitHub runs the `pull_request` event with:

- an empty value for every repository secret
- a `GITHUB_TOKEN` restricted to read-only

The reason is direct: anyone can open a pull request, and a pull request can modify
the workflow file. Without this boundary, a stranger could submit a PR whose workflow
prints your production credentials.

So the workflow must be designed around it rather than fighting it.

### Hint 4 — Detect the condition and skip deliberately

You can test whether the pull request came from a fork:

```yaml
if: github.event.pull_request.head.repo.full_name == github.repository
```

and separately assert that the secret is actually present:

```yaml
- name: Check credentials
  env:
    PREVIEW_TOKEN: ${{ secrets.PREVIEW_TOKEN }}
  run: |
    if [ -z "${PREVIEW_TOKEN}" ]; then
      echo "::error::PREVIEW_TOKEN is not available for this run."
      exit 1
    fi
```

Note the pattern of passing the secret through `env:` rather than interpolating
`${{ secrets.X }}` directly into the `run:` script. Direct interpolation splices the
value into the shell command text, where a secret containing shell metacharacters can
break or inject — the same lesson as the Jenkins quoting trap.

### Hint 5 — Know what `pull_request_target` is before you meet it

You will find advice online recommending `pull_request_target`, which *does* give fork
PRs access to secrets. It does so by running the workflow definition from the **base**
branch with **write** permissions, in the context of your repository.

If you combine it with checking out the pull request's code, you are executing an
untrusted contributor's code with your secrets in scope. That is a well-known and
repeatedly exploited supply-chain vulnerability.

Treat `pull_request_target` as something you use only for jobs that never check out or
execute PR code — labelling, commenting, triage — and never as a way to make previews
work.

## Solution

Two independent faults: a cache key that cannot repeat, and a workflow that assumes
secrets are always present.

### The corrected `.github/workflows/ci.yaml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip
          cache-dependency-path: requirements.txt

      - name: Install
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt

      - name: Test
        run: pytest tests/ -q

  deploy-preview:
    runs-on: ubuntu-latest
    needs: test
    timeout-minutes: 10

    # only for pull requests raised from a branch in this repository;
    # fork PRs have no secrets and must not attempt a deployment
    if: >-
      github.event_name == 'pull_request' &&
      github.event.pull_request.head.repo.full_name == github.repository

    steps:
      - uses: actions/checkout@v4

      - name: Verify credentials are present
        env:
          PREVIEW_TOKEN: ${{ secrets.PREVIEW_TOKEN }}
        run: |
          if [ -z "${PREVIEW_TOKEN}" ]; then
            echo "::error::PREVIEW_TOKEN is not available for this run."
            exit 1
          fi

      - name: Publish preview
        env:
          PREVIEW_TOKEN: ${{ secrets.PREVIEW_TOKEN }}
          HEAD_REF: ${{ github.head_ref }}
          PR_NUMBER: ${{ github.event.number }}
        run: |
          set -euo pipefail
          echo "publishing preview for PR #${PR_NUMBER}"
          curl -sS --fail -X POST \
            -H "Authorization: Bearer ${PREVIEW_TOKEN}" \
            --data-urlencode "ref=${HEAD_REF}" \
            https://preview.example.com/api/deploy
```

If you prefer explicit cache control over `setup-python`'s built-in caching:

```yaml
      - name: Cache pip downloads
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: pip-${{ runner.os }}-py3.11-${{ hashFiles('requirements.txt') }}
          restore-keys: |
            pip-${{ runner.os }}-py3.11-
```

The ideas worth taking away:

- **A cache key is a content fingerprint.** `hashFiles()` over the manifest is the
  canonical pattern. Anything unique per run — the run ID, the commit SHA, a timestamp
  — guarantees a permanent miss, and the failure is quiet because saving still
  "succeeds".
- **Cache what is portable.** Package download caches and language-native caches
  restore cleanly; a built virtualenv contains absolute paths and interpreter
  references that make it fragile across runner images.
- **The fork secret boundary is a feature.** Design two paths: a trusted path with
  credentials for internal branches, and an untrusted path that runs tests and nothing
  else. A contributor should be able to open a PR and get useful CI feedback without
  your organisation trusting them.
- **Pass secrets through `env:`, never inline into `run:`.** Interpolation places the
  literal value into the script text; `env` passes it as a process environment variable
  where the shell cannot re-parse it.
- **`::error::` workflow commands** produce a proper annotation on the run rather than
  a line buried in a log, which is the difference between a contributor understanding
  why their PR was skipped and opening an issue about it.

One caveat about caches and security: cache entries are scoped per branch, and a
pull request branch can read caches from the base branch. Never cache anything
containing credentials, and be aware that cache poisoning from a fork PR is a real
attack class on repositories that cache build outputs rather than dependencies.

## What You Learned

Both problems reported themselves as success. The cache step logged `Cache saved`
every single time, which reads as working, and the deploy step sent a request with an
empty bearer token and blamed the receiving service for the 401. Neither surfaced as a
failure at the point where the mistake was.

The two transferable checks: for a cache, confirm you have seen an actual **restore**
before believing it works, because saving proves nothing. For a credential, assert its
presence explicitly before use, because empty-string substitution turns a
configuration error into a confusing downstream failure — and in GitHub Actions, an
empty secret is not an anomaly but a documented, security-motivated condition your
workflow is expected to handle.
