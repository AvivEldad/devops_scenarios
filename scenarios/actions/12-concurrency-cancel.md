# concurrency cancelled the deploy I needed

## Briefing

You added:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

to save minutes. A slow `main` deploy was cancelled when a docs typo landed on
`main`. Or two PRs shared a group string and killed each other. Concurrency is
a mutex + optional cancel. `cancel-in-progress: true` is right for CI on PR
branches and wrong for production deploys.

## Your Task

- See a deploy cancelled by a newer run in the same group.
- Split groups: PR CI may cancel; production deploy must not.
- Use `cancel-in-progress: false` (queue) for prod.

## Starter Files

### file: .github/workflows/deploy.yml

```yaml
name: deploy
on:
  push:
    branches: [main]
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: sleep 120
      - run: echo deploy
```

## Expected Failure

```text
Run #42 (deploy) in progress
Push a trivial commit
Run #43 starts; #42 shows Cancelled
Production left mid-rollout (or never finished)
```

## Expected Outcome

CI on feature branches cancels old runs; `main` deploy queues or uses a unique
non-cancelling group.

```yaml
concurrency:
  group: deploy-prod
  cancel-in-progress: false
```

Or:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

(The boolean expression must evaluate to a boolean; test it.)

## Hints

### Hint 1 — Group is a string you invent

Same group = same mutex. `${{ github.ref }}` on `main` is one group for all
main runs. `${{ github.sha }}` is unique per commit — concurrency never
collides (useless). PR number is the usual CI group.

### Hint 2 — Cancelled vs queued

`cancel-in-progress: false` (default is false actually — many examples set
true). False = new run waits. True = old run killed. Jobs with
`environment:` protection still wait for approval; concurrency can cancel
while waiting.

## Solution

Do not cancel in-progress production.

```yaml
# ci.yml (PRs)
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

# deploy.yml
concurrency:
  group: production
  cancel-in-progress: false
```

- **Cancelled deploys can leave half-applied terraform/k8s.** Prefer queues
  and job timeouts.
- **`concurrency` at job level** vs workflow level: job-level lets other jobs
  in the workflow proceed.
- **`cancel-in-progress` with matrix** cancels the whole workflow, all cells.
- **Debug:** the cancelled run log says "Cancelled by ..." with the newer run
  ID.
