# The environment gate waited for a reviewer who did not exist

## Briefing

`environment: production` is set so deploys need approval. The job sits on
**Waiting for review** forever. Required reviewers were a user who left the
org, or a team with no living members, or wait-timer is 60 minutes and you
thought it was broken. Environments also inject environment **secrets** — a
job without `environment:` cannot see `secrets.PROD_KEY` even if a repo
secret exists under another name.

## Your Task

- Identify a job stuck on environment protection.
- Fix reviewers / skip environment on non-prod.
- Map environment secrets vs repo secrets.

## Starter Files

### file: .github/workflows/deploy.yml

```yaml
name: deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: echo "deploying with ${{ secrets.PROD_KEY }}"
```

## Expected Failure

```text
deploy: Waiting for review
Required reviewers: @ex-employee
# or: wait timer 30 minutes
PROD_KEY empty if someone removed the environment secret
```

Pushes to `main` should not all wait for prod approval if this workflow also
runs on feature branches.

## Expected Outcome

Production deploys notify valid reviewers; other branches do not use that
environment.

```yaml
jobs:
  deploy:
    if: github.ref == 'refs/heads/main'
    environment: production
```

Reviewers are a current team. `PROD_KEY` is set on the **production**
environment.

## Hints

### Hint 1 — environment: name is a switch

Settings → Environments → production → Required reviewers, wait timer,
deployment branches. `environment: ${{ inputs.env }}` must match a defined
environment exactly (case).

### Hint 2 — Secrets scope

Repo secret `PROD_KEY` ≠ environment secret `PROD_KEY`. The job with
`environment: production` sees environment secrets (overriding repo on name
clash). Jobs without `environment` do not see environment secrets.

## Solution

Restrict the job to `main`; fix reviewers in the UI; put secrets on the
environment.

```yaml
if: github.ref == 'refs/heads/main'
environment:
  name: production
  url: https://prod.example.com
```

- **Deployment branches** can block `workflow_dispatch` from a tag if the
  rule is "main only".
- **Concurrency + environment** = cancelled while waiting (see beginner
  concurrency drill).
- **GitHub environments are not Kubernetes namespaces.** Naming overlap
  confuses humans only.
- **API `gh api` to list environment secrets** if the UI is unclear.
