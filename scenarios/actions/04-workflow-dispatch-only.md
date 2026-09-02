# The workflow only runs when I click the button

## Briefing

You added `workflow_dispatch` so you could test manually. Pushes to `main` never
start CI. The Actions tab shows runs only from "Run workflow". `on:` is a list
of triggers — listing `workflow_dispatch` **alone** replaces the push trigger,
it does not add to some default.

Silence on push is the same symptom as the "workflow never runs" beginner
scenario, with a simpler cause: you deleted `push` when you added the button.

## Your Task

- Confirm the workflow YAML has `workflow_dispatch` but no `push`.
- Add `push` (and `pull_request` if you want PR checks) without dropping
  manual runs.
- Trigger both a push run and a manual run.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: CI
on:
  workflow_dispatch:
    inputs:
      debug:
        type: boolean
        default: false
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "tests"
```

## Expected Failure

```text
Push to main: no run appears.
Actions → CI → "Run workflow" works.
```

`on:` has a single event. GitHub does not imply `push`.

## Expected Outcome

Pushes to `main` start the workflow, and the button still works.

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      debug:
        type: boolean
        default: false
```

A push shows `push` as the event in the run header; a button run shows
`workflow_dispatch`.

## Hints

### Hint 1 — on is exhaustive

Whatever you list is the complete trigger set. `on: [push, pull_request,
workflow_dispatch]` is the short form without filters. Maps let you filter
branches/inputs.

### Hint 2 — workflow_dispatch only exists on the default branch

The button appears for the YAML on the **default** branch. A feature-branch
copy of the file does not add a button until merged (or you run via API with
the ref). That is a second "I cannot click Run" cause.

## Solution

Combine events under `on:`.

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
```

- **Manual-only CI is a trap** for repos that then forget to add `push` before
  making the workflow required.
- **`workflow_dispatch` inputs** are `inputs.*` in the workflow, empty on
  `push` — guard with `github.event_name`.
- **`repository_dispatch`** is the API sibling; still not a push trigger.
- **Filters on `push.branches`** can still silence work — next drill.
