# checkout tested the merge commit, not my branch

## Briefing

PR CI failed on a line you did not write. `actions/checkout` on
`pull_request` checks out a **merge commit** (PR branch merged into the base)
by default. Your branch is fine; `main` is not, or the opposite. `git log -1`
in the log shows `Merge xxx into main`. Debugging locally on the feature
branch cannot reproduce it.

`ref` / `repository` for `pull_request_target` is even more surprising (next
tier). This drill is the default `pull_request` merge ref.

## Your Task

- Add a step that prints `github.sha`, `git log -1`, and
  `github.event.pull_request.head.sha`.
- Explain why they differ on a PR.
- Checkout `head` when you need to test *only* the branch (knowing you lose
  "does it merge cleanly?").

## Starter Files

### file: .github/workflows/pr.yml

```yaml
name: PR
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          git log -1 --oneline
          echo "github.sha=${{ github.sha }}"
      - run: python -m pytest
```

## Expected Failure

```text
git log -1
# Merge 9f3c... into main

pytest fails in main's conftest / a conflicted file
# locally on the PR branch: tests pass
```

`github.sha` is the merge commit, not `head.sha`.

## Expected Outcome

You can choose merge testing (default, recommended for "will this land") or
head-only:

```yaml
- uses: actions/checkout@v4
  with:
    ref: ${{ github.event.pull_request.head.sha }}
    fetch-depth: 0
```

And you print both SHAs in the log so the next person is not confused.

```bash
echo "merge=${{ github.sha }}"
echo "head=${{ github.event.pull_request.head.sha }}"
```

## Hints

### Hint 1 — event name decides the ref

`push`: `github.sha` is the pushed commit. `pull_request`: merge commit.
`pull_request_target`: **base** branch (dangerous with checkout of PR code).
`workflow_dispatch`: whatever `ref` you typed.

### Hint 2 — merge commit can fail to build

If the PR conflicts, the merge ref may not exist and checkout fails — that is
a useful signal. Head checkout would still run.

## Solution

Keep default checkout for "does this PR merge and pass". Add logging. Only
pin `head.sha` for jobs that must match developer laptops exactly (and then
you are not testing the merge).

```yaml
- uses: actions/checkout@v4
- run: |
    echo "event=${{ github.event_name }}"
    echo "sha=${{ github.sha }}"
    echo "head=${{ github.event.pull_request.head.sha }}"
    git log -1 --format='%H %s'
```

- **Reproducing a CI failure locally:** `gh pr checkout` then
  `git fetch origin main && git merge origin/main` — that is what CI ran.
- **`fetch-depth: 1`** on a merge commit is enough for the tree; git history
  of the PR branch is shallow.
- **Codecov / change detection** based on `github.sha` vs base must use the
  right SHAs or the diff is empty/wrong.
- **Do not confuse with `pull_request_target`.** That checkout is the base
  until you deliberately fetch the PR — a security drill later.
