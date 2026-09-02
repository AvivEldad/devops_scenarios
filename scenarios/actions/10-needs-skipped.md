# needs: skipped the deploy because the tests were skipped

## Briefing

`deploy` has `needs: [test]`. `test` has `if: github.ref == 'refs/heads/main'`.
On a PR, `test` is **skipped**, and `deploy` is skipped too — even if you
wanted deploy never to run on PRs (OK) or you wanted a different job to run.
Worse: `if: success()` on deploy does not run when needs were skipped.
`if: always()` runs even on failure (too broad). The operator is
`needs.test.result`.

Skipped needs propagate. This is how "CI is green but nothing deployed" and
"I cannot get the notify job to run" happen.

## Your Task

- Read a workflow where `notify` never runs on PRs because `test` skipped.
- Use `if: always() && needs.test.result != 'failure'` (or `cancelled`)
  correctly.
- Know `success()`, `failure()`, `always()`, `cancelled()`.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo test
  notify:
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - run: echo slack
```

## Expected Failure

```text
On a pull_request:
  test    skipped
  notify  skipped
```

`needs` default `if` is `success()`, and skipped is not success.

## Expected Outcome

`notify` runs on PRs (for example "tests were skipped, not failed") or you
explicitly do not notify on PRs with a clear `if:`.

```yaml
notify:
  needs: [test]
  if: always() && needs.test.result != 'failure'
  runs-on: ubuntu-latest
  steps:
    - run: echo "test result=${{ needs.test.result }}"
```

Results: `success`, `failure`, `cancelled`, `skipped`.

## Hints

### Hint 1 — skipped is a first-class result

A job with a false `if:` is skipped. Dependents skip unless their `if:`
allows it. `always()` is the usual prefix: `always() && needs.x.result ==
'success'`.

### Hint 2 — chain of skips

Three jobs A→B→C: if A skips, B and C skip unless each has a custom `if`.
Fix at each edge.

## Solution

```yaml
notify:
  needs: [test]
  if: |
    always() &&
    needs.test.result != 'failure' &&
    needs.test.result != 'cancelled'
```

Or split: `test` always runs on PRs too (drop the `if` on test).

- **`success()` is the default `if` for `needs` jobs.** Internalise that.
- **`cancelled()`** is true when you hit the red cancel button or fail-fast.
- **Reusable workflows** pass results similarly (`needs.foo.result`).
- **Do not `always()` a deploy job** that would deploy a failed build. Be
  precise.
