# The workflow that never runs

## Briefing

You added a CI workflow three days ago. It has never executed once.

The Actions tab is empty. There is no failed run to click into, no error annotation on
your commits, and no notification. GitHub is not complaining, because from its point
of view nothing has gone wrong — you simply have not asked it to do anything it
recognises.

Silence is the hardest CI failure to debug, because every other failure at least gives
you a log. Here there are four separate reasons this file is being ignored, and you
have to find them without any output at all.

> You need a GitHub repository you can push to. A private repo is fine; Actions
> minutes are free for public repositories and generous on the free tier for private
> ones.

## Your Task

Create the repository, add the files exactly as given, push, and confirm nothing runs.

1. Find every reason the workflow is not triggering. There are four.
2. Fix them so the workflow runs on a push to `main` and on pull requests targeting
   `main`.
3. Confirm the run appears and passes.

Do not delete the file and start over from a template. Finding out why an existing
workflow is ignored is the skill.

## Starter Files

### file: workflows/ci.yaml

```yaml
name: CI

on:
  push:
    branches:
      - master
    paths:
      - 'src/**'
  pull_request:
    branches:
      - master

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Run tests
        run: pytest tests/ -q
```

### file: requirements.txt

```text
pytest==8.2.0
```

### file: app/calc.py

```python
def add(a, b):
    return a + b


def divide(a, b):
    if b == 0:
        raise ValueError("division by zero")
    return a / b
```

### file: tests/test_calc.py

```python
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.calc import add, divide


def test_add():
    assert add(2, 3) == 5


def test_divide():
    assert divide(10, 2) == 5


def test_divide_by_zero():
    try:
        divide(1, 0)
    except ValueError:
        return
    raise AssertionError("expected ValueError")
```

## Expected Failure

Set the repository up exactly as the starter files describe:

```bash
mkdir -p ~/breakfix/actions-01 && cd ~/breakfix/actions-01
git init -b main
mkdir -p workflows app tests
# save the four files, then:
git add -A
git commit -m "add CI workflow"
git remote add origin git@github.com:YOU/breakfix-actions.git
git push -u origin main
```

Open the repository's **Actions** tab:

```
There are no workflow runs yet.
```

Push again, change a file, open a pull request — nothing. No run, no error, no
annotation anywhere in the UI. The workflow file is valid YAML and GitHub will not
tell you it is being ignored.

Even after you fix the trigger, the run will fail on the test step, so there is a
fifth thing to sort out before this is a working pipeline.

## Expected Outcome

The workflow runs automatically and passes.

A push to `main` produces a run:

```bash
gh run list --limit 3
# STATUS   NAME  WORKFLOW  BRANCH  EVENT
# success  CI    CI        main    push
```

or in the UI, the Actions tab shows a green **CI** run against your latest commit.

A pull request targeting `main` also triggers it:

```bash
git checkout -b test-pr
echo "# change" >> app/calc.py
git commit -am "test pr trigger"
git push -u origin test-pr
gh pr create --fill --base main
gh run list --limit 3
# a run with EVENT = pull_request
```

The tests actually execute and pass:

```bash
gh run view --log | grep -E '3 passed|passed in'
# 3 passed in 0.02s
```

A change **outside** `src/` still triggers the workflow, since this project has no
`src/` directory at all:

```bash
echo "# doc" >> README.md
git commit -am "docs only"
git push
gh run list --limit 1
# a run appears
```

And the workflow file is where GitHub looks for it:

```bash
git ls-files | grep workflows
# .github/workflows/ci.yaml
```

Finally, confirm a genuine failure is reported. Break a test deliberately:

```bash
# change test_add to assert add(2, 3) == 6
gh run list --limit 1
# STATUS = failure
```

## Hints

### Hint 1 — GitHub only looks in one directory

Workflow files must live in `.github/workflows/` at the root of the repository. Yours
is in `workflows/`.

A file anywhere else is just a YAML file. GitHub does not scan for it, does not warn
about it, and does not surface it in the UI — which is exactly why the failure is
silent.

```bash
git ls-files | grep -i workflow
```

Both `.yml` and `.yaml` extensions are accepted.

### Hint 2 — Check the branch name against reality

```yaml
on:
  push:
    branches:
      - master
```

What is your default branch actually called?

```bash
git branch --show-current
```

GitHub has defaulted to `main` for new repositories since 2020, and workflow templates
copied from older projects still say `master`. The trigger is filtering for a branch
that does not exist, so it matches nothing.

### Hint 3 — Path filters are an allow-list

```yaml
paths:
  - 'src/**'
```

This says: only run when a file under `src/` changed. This repository has `app/` and
`tests/`, and no `src/` directory at all — so even on the right branch, no push would
ever match.

Path filtering is genuinely useful in a monorepo, but it must match your actual
layout. If you want the workflow to run on everything, remove the filter. If you want
to skip documentation-only changes, `paths-ignore` is usually the clearer expression
of that intent.

### Hint 4 — The test step will fail once it finally runs

Two problems await you. `pip install -r requirements.txt` will work, but the tests
import `app.calc` while `pytest` is invoked from the repository root — check whether
the import path manipulation in the test file is doing what it looks like.

More importantly, think about whether `sys.path` hacking in a test file is the right
answer, or whether the workflow should tell pytest where the code is.

### Hint 5 — Validate the trigger without pushing twenty times

`workflow_dispatch` adds a manual "Run workflow" button, which lets you test the job
body independently of whether the automatic trigger is correct:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
```

You can also lint workflow files locally with `actionlint`, which catches invalid keys,
bad expressions and unknown event names before you push:

```bash
# https://github.com/rhysd/actionlint
actionlint .github/workflows/ci.yaml
```

## Solution

Four reasons for the silence, then one real failure.

**Fault 1 — wrong directory.** The file must be at `.github/workflows/ci.yaml`.

```bash
mkdir -p .github/workflows
git mv workflows/ci.yaml .github/workflows/ci.yaml
rmdir workflows
```

**Fault 2 — wrong branch.** The repository's default branch is `main`, not `master`.

**Fault 3 — a path filter that matches nothing.** There is no `src/` directory.

**Fault 4 — the tests cannot import the application** in a clean checkout the way they
are invoked.

### The corrected `.github/workflows/ci.yaml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

# stop a superseded run when a new commit lands on the same branch
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt

      - name: Run tests
        env:
          PYTHONPATH: ${{ github.workspace }}
        run: pytest tests/ -q
```

Setting `PYTHONPATH` in the workflow lets you delete the `sys.path` manipulation from
the test file, which is the cleaner fix:

```python
from app.calc import add, divide


def test_add():
    assert add(2, 3) == 5
```

Push and confirm:

```bash
git add -A
git commit -m "fix workflow location, triggers and import path"
git push
gh run list --limit 3
gh run watch
```

Things worth knowing beyond the immediate fixes:

- **Trigger filters are ANDed.** `branches` and `paths` must both match. Two filters
  that are each individually reasonable can combine into something that never fires,
  and nothing warns you.
- **`pull_request` runs against a merge commit** of your branch and the base, not your
  branch as-is. That is usually what you want, and it explains occasional differences
  between a `push` run and a `pull_request` run on the same code.
- **`concurrency` with `cancel-in-progress`** stops five queued runs piling up when you
  push five commits in a row. On a busy repository this is the single highest-value
  line you can add.
- **`permissions: contents: read`** narrows the default token. The default is
  repository-configurable and often broader than a test job needs. Declare the minimum
  and expand deliberately.
- **`timeout-minutes`** prevents a hung job consuming six hours of runner time, which
  is the platform default.
- **`cache: pip`** in `setup-python` caches dependency downloads with no extra
  configuration.

For the silent-failure problem specifically, `actionlint` in a pre-commit hook is the
systematic answer. It catches the invalid-key and bad-expression class of error, which
otherwise also fails silently.

## What You Learned

Every other CI failure hands you a log. This one hands you nothing, because a workflow
file that GitHub does not recognise is indistinguishable from a workflow file that does
not exist — and three of the four faults here were single words in otherwise valid
configuration.

The diagnostic habit is to work outward from the platform's assumptions rather than
inward from your file. Is it in the directory GitHub reads? Does the event match? Do
the filters match? Only then look at the job body. And when you are iterating on a
trigger, add `workflow_dispatch` so you can test the job independently of the question
you are still trying to answer.
