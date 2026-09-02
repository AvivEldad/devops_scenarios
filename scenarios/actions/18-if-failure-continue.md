# if: failure() never ran because the job was skipped

## Briefing

You added a `notify` step with `if: failure()` at the **step** level, but the
failing thing was a **previous job**, or the job was skipped, or the failing
step had `continue-on-error: true` (step status is success). `failure()` at
step level is "a previous **step** in this job failed". For jobs, use
`if: failure()` on the **job** with `needs:`.

The functions `success()`, `failure()`, `always()`, `cancelled()` change
meaning by level.

## Your Task

- Put `if: failure()` on a step in a job that did not fail a step (the
  sibling job did).
- Move notification to a job with `needs` + `if: failure()`.
- Show `continue-on-error` hiding `failure()`.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
        continue-on-error: true
      - name: notify
        if: failure()
        run: echo "would slack"
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: echo deploy
```

## Expected Failure

```text
notify step skipped (failure() is false — continue-on-error)
deploy runs (test job succeeded overall)
```

No Slack. Prod deployed a failed test.

## Expected Outcome

A `notify` **job** runs when `test` fails; `continue-on-error` is not used on
the real test step.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pytest
  notify:
    needs: test
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - run: echo slack
```

`deploy` has `needs: test` and default `if: success()`.

## Hints

### Hint 1 — step vs job status

`continue-on-error: true` → step conclusion failure, job success. `failure()`
on later steps is false. Use `steps.x.outcome == 'failure'` if you must.

### Hint 2 — job-level failure()

`if: failure()` on a job is true if **any needed job failed**. Combine
`always()` when needs include skipped (beginner needs drill).

## Solution

```yaml
test:
  steps:
    - run: pytest
notify:
  needs: [test]
  if: failure()
  steps:
    - run: ./slack.sh
deploy:
  needs: [test]
  # default success()
```

- **`steps.notify.outcome`** vs `conclusion` — conclusion is `success` with
  continue-on-error; outcome is `failure`. Read the docs once; it sticks.
- **Matrix:** `failure()` on a sibling job after one cell fails depends on
  fail-fast and `needs`.
- **Do not `if: failure()` a checkout** you need for the notify script —
  notify job is a new VM; checkout again or use a curl-only slack step.
- **Secrets in notify jobs** still need permissions/environment.
