# paths: I changed the app and CI did not run

## Briefing

The workflow has `paths: ['src/**']` or `paths-ignore: ['**']` leftover from a
docs-only optimisation. You changed `app.py` at the repo root (or `backend/`)
and no check ran. GitHub skipped the workflow as "up to date" / no files
matched. Required status checks then wait forever on a check that was never
queued.

Path filters are **skip**, not "run always for safety". Combined with branch
protection, they deadlock PRs.

## Your Task

- Change a file outside `src/**` and see the workflow skipped.
- Adjust `paths` so application code is included.
- Know how skipped required checks need `paths` + a reporting dummy or
  `concurrency` — or drop the filter.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: CI
on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "!src/**/*.md"
  pull_request:
    paths:
      - "src/**"
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: python -m pytest
```

## Expected Failure

```text
Commit touches app.py (repo root) or pkg/foo.py
→ workflow skipped (no src/** change)
PR cannot merge if CI is a required check: "Expected — Waiting for status"
```

The skip is intentional per YAML; the required check is unaware.

## Expected Outcome

Application changes trigger CI. Docs-only changes may still skip if you keep a
*correct* filter.

```yaml
on:
  pull_request:
    paths:
      - "src/**"
      - "app.py"
      - "pkg/**"
      - "tests/**"
      - "pyproject.toml"
      - ".github/workflows/ci.yml"   # so workflow edits are tested
```

Or remove `paths` until you also add a "report skipped as success" companion
workflow.

## Hints

### Hint 1 — Workflow file should include itself

If you do not list `.github/workflows/ci.yml`, edits to CI never run on the PR
that changes CI. Always add the workflow path to `paths`.

### Hint 2 — Required checks + skip = deadlock

GitHub docs: use a second workflow on `pull_request` without paths that exits
0, or the `paths-filter` action inside the job. Branch protection "require
status checks" needs a check with that exact name on every PR.

## Solution

Widen `paths` to the real layout; include the workflow file.

```yaml
paths:
  - "**/*.py"
  - "pyproject.toml"
  - "requirements*.txt"
  - ".github/workflows/ci.yml"
```

For required checks with docs-only skips, add a pass-through job:

```yaml
# separate workflow without path filters that still reports the same check name
# or: jobs.test.if: ... plus an always() reporter — keep names stable
```

- **Skipped ≠ passed.** Merge queues and protection rules care about the check
  name existing.
- **`paths-ignore: ['**']`** is a workflow that never runs. Search for it.
- **Monorepos** need per-project filters *and* a strategy for required checks
  per path (paths-filter + matrix).
- **First commit on a new branch** can have a surprising diff base for `paths`
  (the default branch). Worth a test PR.
