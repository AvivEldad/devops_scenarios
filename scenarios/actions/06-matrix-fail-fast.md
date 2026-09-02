# The matrix cancelled the good jobs

## Briefing

`strategy.matrix` tests py3.10–3.12 and ubuntu/macos. One cell fails (3.10 +
macos). The rest show **Cancelled**. `fail-fast` defaults to **true**: one
failure cancels siblings. You lose the signal from the other 5 cells, and a
flake looks like "everything is broken".

`fail-fast: false` plus `continue-on-error` on known-broken cells is how you
see the full picture.

## Your Task

- Read a matrix workflow with default fail-fast.
- Set `fail-fast: false` and re-run so all cells finish.
- Optionally mark an experimental cell `continue-on-error: true`.

## Starter Files

### file: .github/workflows/test.yml

```yaml
name: test
on: [push]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        python: ["3.10", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
      - run: python -m pytest
```

## Expected Failure

```text
test (macos-latest, 3.10)  failed
test (ubuntu-latest, 3.12) cancelled
test (ubuntu-latest, 3.10) cancelled
...
```

One real failure, three unknown. You cannot tell if 3.12 is fine.

## Expected Outcome

All four cells run to completion. The job is still failed if any required cell
failed.

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest]
    python: ["3.10", "3.12"]
```

The run summary shows 1 failed, 3 passed (for example).

## Hints

### Hint 1 — fail-fast is a strategy key

It is not `job.continue-on-error`. `continue-on-error: true` on the job lets
the **workflow** proceed to `needs:` dependents even if this job failed;
fail-fast is between matrix cells.

### Hint 2 — include experimental

```yaml
matrix:
  python: ["3.10", "3.12"]
  include:
    - python: "3.13"
      experimental: true
steps:
  - ...
    continue-on-error: ${{ matrix.experimental == true }}
```

(You need `experimental: false` on others or `== true` check.)

## Solution

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest]
    python: ["3.10", "3.12"]
```

- **Default fail-fast bites flakes.** For CI signal, `false` is usually right;
  for "stop spending minutes when the build is doomed", `true`.
- **Max-parallel** throttles; it is not fail-fast.
- **Cancelled jobs** can still count against billable time for a short period;
  they do not produce artifacts.
- **Required matrix check names** include the cell (`test (ubuntu, 3.10)`).
  Protection rules that name the parent job only may not match — GitHub
  expanded this over time; verify the exact check names.
