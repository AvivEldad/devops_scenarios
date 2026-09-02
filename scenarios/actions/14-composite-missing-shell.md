# The composite action did not run my setup

## Briefing

You extracted steps into `./.github/actions/setup` (`action.yml` with
`runs.using: composite`). The caller `uses:` it but Node is not on `PATH`, or
`run:` inside the composite uses `bash` on Windows and fails, or outputs are
empty because you wrote `$GITHUB_OUTPUT` in a subshell. Composite actions are
not jobs; they share the caller's workspace and must set `shell:` on every
`run`.

Docker actions vs composite vs JS is a separate choice — this drill is
"composite that does nothing useful".

## Your Task

- Find a composite `action.yml` missing `shell:` or using the wrong `working-directory`.
- Fix it so the caller has Python on PATH after `uses:`.
- Export an output via `$GITHUB_OUTPUT`.

## Starter Files

### file: .github/actions/setup-python-app/action.yml

```yaml
name: setup-python-app
runs:
  using: composite
  steps:
    - uses: actions/setup-python@v5
      with:
        python-version: "3.12"
    - run: pip install -r requirements.txt
    - run: echo "python=$(which python)" >> $GITHUB_OUTPUT
      id: loc
outputs:
  python:
    value: ${{ steps.loc.outputs.python }}
```

### file: .github/workflows/ci.yml

```yaml
name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-python-app
      - run: python -m pytest
```

## Expected Failure

```text
Error: run steps in a composite action must specify shell
# or pip install runs, python not found in the next caller step because
# setup-python in composite should work... unless shell missing aborted
```

If `shell` is added later but `pip` uses a different python than `python -m
pytest` in the caller, still broken.

## Expected Outcome

Caller `python -m pytest` runs; output is the interpreter path.

```yaml
- run: pip install -r requirements.txt
  shell: bash
- run: echo "python=$(which python)" >> "$GITHUB_OUTPUT"
  shell: bash
  id: loc
```

## Hints

### Hint 1 — shell is required

Every composite `run:` needs `shell: bash` (or `pwsh`). There is no default.
`working-directory` is allowed per step.

### Hint 2 — outputs and GITHUB_OUTPUT

`>> $GITHUB_OUTPUT` in a pipeline may be a subshell — write as a single
redirect. Quote `"$GITHUB_OUTPUT"`. The `outputs:` map in `action.yml` must
reference `steps.id.outputs.x`.

## Solution

```yaml
runs:
  using: composite
  steps:
    - uses: actions/setup-python@v5
      with:
        python-version: "3.12"
    - run: pip install -r "${{ github.action_path }}/requirements.txt"
      shell: bash
    - id: loc
      shell: bash
      run: echo "python=$(which python)" >> "$GITHUB_OUTPUT"
```

Use `${{ github.action_path }}` for files next to `action.yml`.

- **Composite cannot use `services:` or `timeout-minutes` at action level**
  the same way jobs can.
- **`setup-python` in composite does persist PATH** to following caller steps
  on that job — if it actually ran.
- **Version the action** with a tag if you publish it; local `./` path is
  relative to the **consumer** repo after checkout.
- **Docker `using: docker`** is heavier and isolates PATH — do not expect
  setup-python inside Docker to affect the caller VM.
