# secrets: inherit passed production into a docs workflow

## Briefing

A reusable workflow used `secrets: inherit` because mapping was tedious. The
callee was a **docs** builder that logged env for debug (`set -x`,
`printenv`). Production `AWS_*` appeared in the log. `inherit` is all secrets
the caller has, not "the ones you mentioned in the callee schema". Combined
with a callee that does not even declare `secrets:`, inherit still passes
them into `secrets` context for that run.

Least privilege for reusable workflows is explicit `secrets:` keys.

## Your Task

- Call a reusable workflow with `inherit` and a debug `printenv` step.
- Switch to an explicit map of one secret.
- Confirm `secrets.AWS_SECRET_ACCESS_KEY` is not available in the docs job.

## Starter Files

### file: .github/workflows/docs.yml

```yaml
name: docs
on: workflow_call
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: printenv | sort
```

### file: .github/workflows/ci.yml

```yaml
name: ci
on: push
jobs:
  docs:
    uses: ./.github/workflows/docs.yml
    secrets: inherit
```

## Expected Failure

```text
printenv includes:
AWS_SECRET_ACCESS_KEY=***     (masked but present; still leaked via other keys)
NPM_TOKEN=***
# docs job had no reason to receive these
```

Masking hides values in the UI; `inherit` still **delivered** them to the
runner (disk, memory, a malicious step).

## Expected Outcome

Docs callee has zero secrets; deploy callee lists only `DEPLOY_KEY`.

```yaml
# ci.yml
jobs:
  docs:
    uses: ./.github/workflows/docs.yml
    # no secrets:
  deploy:
    uses: ./.github/workflows/deploy.yml
    secrets:
      DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
```

`printenv` in docs shows no `DEPLOY_KEY`.

## Hints

### Hint 1 — inherit is not filtered by callee secrets: block

If the callee omits `on.workflow_call.secrets`, inherit still injects
everything into `secrets.*` for expressions and for the runner environment
when mapped to `env`. Explicit callee schema + explicit caller map.

### Hint 2 — printenv is a finding

Ban `printenv` / `env` / `set` in production workflows. GitHub masking is
best-effort (substring).

## Solution

```yaml
docs:
  uses: ./.github/workflows/docs.yml
deploy:
  uses: ./.github/workflows/deploy.yml
  secrets:
    DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
```

- **Org-level secrets** inherited into a forked reusable workflow in another
  repo are a separate blast radius — `inherit` across repos needs
  `access:`.
- **Review `secrets: inherit` in PRs** like you review `permissions:
  write-all`.
- **OIDC is better than long-lived keys** in any callee that hits AWS (see
  actions-03).
- **Callee `permissions:`** should also be minimal so a leaked token is
  read-only.
