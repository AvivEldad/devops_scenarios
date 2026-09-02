# GITHUB_TOKEN cannot push the release tag

## Briefing

A release job `git push origin v1.2.3` (or `gh release create`) fails with
`Resource not accessible by integration` or the push is silently ignored. The
default `GITHUB_TOKEN` permissions were tightened: `contents: read` for
`GITHUB_TOKEN` in many orgs. You need `contents: write` (and maybe
`id-token: write` for OIDC, already an expert topic).

`permissions:` at workflow or job level is the fix — not a PAT unless you
must reach other repos.

## Your Task

- See a workflow with default or `contents: read` trying to push a tag.
- Add the minimum `permissions:` for that job.
- Avoid `permissions: write-all`.

## Starter Files

### file: .github/workflows/release.yml

```yaml
name: release
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  tag:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          git tag v0.0.0-ci
          git push origin v0.0.0-ci
```

## Expected Failure

```text
remote: Write access to repository not granted.
fatal: unable to access 'https://github.com/...'
# or: Resource not accessible by integration
```

Checkout succeeded (read). Push failed (write).

## Expected Outcome

The job can create the tag/release; other jobs stay read-only.

```yaml
jobs:
  tag:
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git tag v0.0.0-ci
          git push origin v0.0.0-ci
```

## Hints

### Hint 1 — Job permissions override workflow

A workflow-level `contents: read` plus job-level `contents: write` is the
least privilege pattern. `actions: read` etc. as needed. `packages: write`
for GHCR.

### Hint 2 — Protected branches

Even with `contents: write`, branch protection can block pushes to `main`.
Tag push may still work. Use a PAT + bypass only if policy allows; prefer
`GITHUB_TOKEN` and tagging.

## Solution

Grant `contents: write` on the releasing job only.

```yaml
permissions:
  contents: read
jobs:
  tag:
    permissions:
      contents: write
```

- **`GITHUB_TOKEN` cannot trigger later workflows** (by design, to stop
  recursion). Tag-push may not start `on: push tags` workflows. Use
  `workflow_dispatch` or a PAT (discouraged) / `GH_TOKEN` with
  `workflow` scope if you must.
- **`id-token: write`** is for OIDC, not git push.
- **`packages: write` + `contents: read`** is the GHCR combo.
- **Audit logs** show `github-actions[bot]` — expected.
