# Merge queue says required check is missing

## Briefing

You enabled merge queue. PRs sit in the queue; the queue branch
`gh-readonly-queue/main/...` runs workflows, but your required check is named
`test` on `pull_request` and **never registers** on `merge_group`. The queue
times out waiting for a check that the workflow did not run because
`on:` lacks `merge_group`.

Merge queue is a different event. Required checks must fire on that event
with the **same check name**.

## Your Task

- Add `merge_group` to `on:` (or `on: [pull_request, merge_group]`).
- Confirm the check name matches branch protection / ruleset.
- Avoid `paths:` filters that skip the queue commit.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest
```

## Expected Failure

```text
Merge queue: waiting for required status "test"
No workflow run exists for the merge_group event
Queue PR eventually fails / is kicked
```

`pull_request` checks were green; the queue is a new commit (the proposed
merge) that never ran CI.

## Expected Outcome

A `merge_group` run appears; check name `test` is green; the PR merges.

```yaml
on:
  pull_request:
  merge_group:
```

Ruleset required check: `test` (job id) still matches.

## Hints

### Hint 1 — Event name

`github.event_name == 'merge_group'`. `github.ref` looks like
`refs/heads/gh-readonly-queue/main/pr-123-...`. Path filters using
`src/**` still apply to that commit's diff vs base — can skip. Include the
workflow file in paths.

### Hint 2 — Job name vs workflow name

Required checks use the **job** name (or a status from an action). Renaming
`test` to `pytest` breaks the queue until the ruleset updates. Matrix jobs
have extra suffixes.

## Solution

```yaml
on:
  pull_request:
  merge_group:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest
```

- **`push` to main** is after merge; it does not satisfy the queue.
- **Concurrency groups** using `github.ref` isolate queue branches — good.
  Using `github.workflow` only may cancel the queue run with a PR run.
- **Secrets on merge_group** are trusted (base repo). Do not checkout
  untrusted extra remotes.
- **Read GitHub "merge queue" docs** when a check is "Expected — Waiting"
  after you already added the event — name mismatch is the #2 cause.
