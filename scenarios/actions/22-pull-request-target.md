# pull_request_target checked out the fork and kept the secrets

## Briefing

CI needed secrets on PRs from forks. Someone switched `on: pull_request` to
`pull_request_target` and kept `actions/checkout` without pinning `ref` to the
**base**. `pull_request_target` runs in the **base** repo context (secrets
available) while an unpinned checkout of the PR `ref` runs **attacker code**
with those secrets. This is the highest-severity Actions footgun still in
the wild.

This drill is about recognising and removing that combination — not about
building an exploit.

## Your Task

- Identify `pull_request_target` plus checkout of `github.event.pull_request.head`.
- Split: untrusted CI (`pull_request`, no secrets) vs trusted (`workflow_run`
  after success, no attacker checkout).
- If you must use `pull_request_target` (labeler, comment), **never** run
  untrusted files from the PR.

## Starter Files

### file: .github/workflows/pr.yml

```yaml
name: pr
on: pull_request_target
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: npm test
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Expected Failure

```text
The workflow is privileged (base repo token + secrets)
AND executes package.json / npm test from the PR head.
A fork PR can send those secrets to an external host.
```

There is no red banner that says this. The job is green.

## Expected Outcome

Fork PRs run without secrets; privileged jobs do not checkout PR code.

```yaml
on: pull_request
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - run: npm test
        # no NPM_TOKEN
```

Labeler:

```yaml
on: pull_request_target
jobs:
  label:
    steps:
      - uses: actions/labeler@v5
        # uses base repo's labeler.yml, not PR code
```

## Hints

### Hint 1 — Context vs code

`pull_request_target`: GITHUB_TOKEN and secrets from **base**. Default
checkout is **base**. Adding `ref: head.sha` undoes the safety. `pull_request`:
code from the PR, **no** secrets from the base (for forks).

### Hint 2 — workflow_run is the trusted follow-up

A privileged workflow `on: workflow_run` after the untrusted CI succeeds can
comment or deploy using artifacts you **uploaded as files you produced**,
not by running the PR's Makefile. Validate artifact contents.

## Solution

Delete `pull_request_target` from any job that installs/runs PR code.

```yaml
on: pull_request
# secrets: none
```

- **`permissions: contents: read` is not enough** if you still execute PR
  JavaScript. Least privilege ≠ safe checkout.
- **`github.event.pull_request.head.repo.fork`** can gate, but skipping
  checkout of head is simpler.
- **Review CODEOWNERS for `.github/workflows`.** A PR that edits this file
  should not be auto-merged.
- **Treat historical logs** as leaked if this pattern ever ran on a public
  fork PR; rotate secrets.
