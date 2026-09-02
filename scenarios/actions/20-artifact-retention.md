# The artifact expired before the manual deploy

## Briefing

Build runs on push; a human deploys two weeks later with `workflow_dispatch`
that `download-artifact`. Error: `Artifact not found` or the run is too old.
Default retention is 90 days **or** the repo/org setting (often 1–9 days).
`retention-days: 1` on upload looked fine in testing. Cross-workflow
`download-artifact` needs `run-id` of the **build** run, not "latest on
main" unless you query for it.

## Your Task

- Upload with a short retention; wait / simulate expiry.
- Download by `run-id` from `gh run list`.
- Set retention that matches the real deploy lag, or re-build in the deploy
  workflow.

## Starter Files

### file: .github/workflows/build.yml

```yaml
name: build
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo bin > app.bin
      - uses: actions/upload-artifact@v4
        with:
          name: app
          path: app.bin
          retention-days: 1
```

### file: .github/workflows/deploy.yml

```yaml
name: deploy
on: workflow_dispatch
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: app
```

## Expected Failure

```text
deploy (workflow_dispatch): Artifact not found for name app
```

`download-artifact` without `run-id` looks at **this** run, which never
uploaded `app`. Even with `run-id`, retention-days: 1 may have deleted it.

## Expected Outcome

Deploy finds the artifact from a specific successful build, within retention.

```yaml
- uses: actions/download-artifact@v4
  with:
    name: app
    github-token: ${{ secrets.GITHUB_TOKEN }}
    run-id: ${{ inputs.run_id }}
```

`retention-days: 14` (or whatever policy is). Permissions `actions: read`.

## Hints

### Hint 1 — Artifacts belong to a run

Same workflow, later job: `needs` + download, no `run-id`. Different
workflow: you must pass `run-id` (input) or use `gh run download`.

### Hint 2 — Org retention cap

Repo cannot exceed org max. Setting 90 in YAML is silently capped. Check
org Actions retention.

## Solution

Pass the build `run-id` into deploy; raise retention; or build in the deploy
workflow (simplest).

```yaml
# deploy.yml
on:
  workflow_dispatch:
    inputs:
      run_id:
        required: true
permissions:
  actions: read
  contents: read
```

- **v4 artifacts** are not downloadable from other repos without extra
  tokens.
- **Immutability:** you cannot overwrite `name: app` in the same job twice
  in v4.
- **Compliance:** shorter retention is good; then do not design 30-day lag
  deploys on artifacts.
- **Packages/releases** are the durable alternative for binaries (GHCR,
  GitHub Releases).
