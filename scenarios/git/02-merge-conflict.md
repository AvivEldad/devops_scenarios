# A merge conflict in a pipeline file

## Briefing

Two people edited the CI configuration during the same sprint.

- `feature/cache-deps` added dependency caching to speed the build up.
- `feature/security-scan` added a vulnerability scan stage and bumped the runner image.

Both branches are correct on their own. `main` needs both. Git cannot combine them
because they changed the same lines, so it hands the problem to you.

The trap in this scenario is that it is easy to make git happy and the pipeline
wrong. A conflict marker removed is not a conflict resolved.

## Your Task

Run the setup script, then merge both branches into `main` so that the resulting
pipeline keeps **every** intended change from both sides.

1. Merge `feature/cache-deps` into `main`.
2. Merge `feature/security-scan` into `main` and resolve the conflict.
3. Verify the merged file is valid YAML and contains all the intended behaviour.

```bash
mkdir -p ~/breakfix/git-02 && cd ~/breakfix/git-02
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Creates a repository with two conflicting feature branches.
set -euo pipefail

rm -rf ci-conflict
mkdir ci-conflict
cd ci-conflict

git init -q -b main
git config user.email "you@example.com"
git config user.name "You"

cat > .gitlab-ci.yml <<'EOF'
image: python:3.11-slim

stages:
  - test
  - build

variables:
  PIP_INDEX_URL: "https://pypi.org/simple"

test:
  stage: test
  script:
    - pip install -r requirements.txt
    - pytest -q

build:
  stage: build
  script:
    - docker build -t app:$CI_COMMIT_SHA .
EOF

cat > requirements.txt <<'EOF'
pytest==8.2.0
EOF

git add -A
git commit -q -m "initial pipeline"

# ---- branch 1: dependency caching ----
git checkout -q -b feature/cache-deps
cat > .gitlab-ci.yml <<'EOF'
image: python:3.11-slim

stages:
  - test
  - build

variables:
  PIP_INDEX_URL: "https://pypi.org/simple"
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.pip-cache"

cache:
  key: "$CI_COMMIT_REF_SLUG"
  paths:
    - .pip-cache/

test:
  stage: test
  script:
    - pip install --cache-dir "$PIP_CACHE_DIR" -r requirements.txt
    - pytest -q

build:
  stage: build
  script:
    - docker build -t app:$CI_COMMIT_SHA .
EOF
git commit -q -am "cache pip downloads between runs"

# ---- branch 2: security scanning ----
git checkout -q main
git checkout -q -b feature/security-scan
cat > .gitlab-ci.yml <<'EOF'
image: python:3.12-slim

stages:
  - test
  - scan
  - build

variables:
  PIP_INDEX_URL: "https://pypi.org/simple"
  TRIVY_SEVERITY: "HIGH,CRITICAL"

test:
  stage: test
  script:
    - pip install -r requirements.txt
    - pytest -q

scan:
  stage: scan
  script:
    - trivy fs --severity "$TRIVY_SEVERITY" --exit-code 1 .

build:
  stage: build
  script:
    - docker build -t app:$CI_COMMIT_SHA .
EOF
git commit -q -am "add trivy scan stage and bump python to 3.12"

git checkout -q main
echo "Repository created at $(pwd)"
git --no-pager log --oneline --all --graph
```

## Expected Failure

```bash
bash setup.sh
cd ci-conflict

git merge feature/cache-deps      # fast-forward or clean, no drama
git merge feature/security-scan
```

```
Auto-merging .gitlab-ci.yml
CONFLICT (content): Merge conflict in .gitlab-ci.yml
Automatic merge failed; fix conflicts and then commit the result.
```

Open the file and you get the familiar markers:

```
<<<<<<< HEAD
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.pip-cache"
=======
  TRIVY_SEVERITY: "HIGH,CRITICAL"
>>>>>>> feature/security-scan
```

The tempting move is to pick one side, delete the markers, and commit. Do that and
you silently drop either the caching or the scan stage — and nobody will notice
until an incident.

## Expected Outcome

The merge is committed and the pipeline contains everything from both branches.

No conflict markers survive anywhere:

```bash
grep -rn '<<<<<<<\|=======\|>>>>>>>' .gitlab-ci.yml
# (no output)
```

The file is valid YAML:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.gitlab-ci.yml')); print('valid yaml')"
# valid yaml
```

Every intended change from both branches is present:

```bash
grep -q 'python:3.12-slim'   .gitlab-ci.yml && echo "image bumped"
grep -q 'PIP_CACHE_DIR'      .gitlab-ci.yml && echo "cache variable"
grep -q -A2 '^cache:'        .gitlab-ci.yml && echo "cache block"
grep -q 'TRIVY_SEVERITY'     .gitlab-ci.yml && echo "scan variable"
grep -q '^  - scan$'         .gitlab-ci.yml && echo "scan stage declared"
grep -q '^scan:'             .gitlab-ci.yml && echo "scan job defined"
grep -q 'cache-dir'          .gitlab-ci.yml && echo "test job uses cache"
```

All seven lines must print. The stage list must contain `test`, `scan`, `build` in
that order.

The history records a real merge with two parents:

```bash
git log --oneline --graph -n 5
git cat-file -p HEAD | grep -c '^parent'
# 2
```

And the working tree is clean:

```bash
git status --short
# (no output)
```

## Hints

### Hint 1 — See both sides before editing

Do not start by deleting markers. First understand what each side intended:

```bash
git diff --name-only --diff-filter=U     # which files are conflicted
git log --oneline main..feature/security-scan
git diff main...feature/security-scan -- .gitlab-ci.yml
```

The three-dot diff shows what the branch changed relative to where it forked, which
is exactly "what did this author intend".

### Hint 2 — Look at all three versions, not two

Git keeps three versions of a conflicted file, and reading the common ancestor is
what turns guessing into reasoning:

```bash
git show :1:.gitlab-ci.yml   # base: the common ancestor
git show :2:.gitlab-ci.yml   # ours: main, with caching already merged
git show :3:.gitlab-ci.yml   # theirs: the security-scan branch
```

Now the question becomes precise: which lines did each side *add* relative to the
base? Those additions are what must all survive.

### Hint 3 — Resolve by intent, then verify by behaviour

For each conflicted region ask "is this an either/or, or a both?".

- The image line is genuinely either/or: only one image can be set, and the intent
  was to upgrade, so `3.12-slim` wins.
- The variables block is a both: `PIP_CACHE_DIR` and `TRIVY_SEVERITY` are unrelated
  keys and belong together.
- The stages list is a both, with `scan` between `test` and `build`.
- The `test` job's script came from the caching branch and must keep `--cache-dir`.

### Hint 4 — Do not trust your eyes on YAML

After resolving, parse it. A merge that produces a duplicated key or a broken indent
is still a broken pipeline, and YAML fails in quiet ways — a duplicate key silently
overrides rather than erroring in some parsers.

If you make a mess, `git merge --abort` returns you to the state before the merge.
That is always available until you commit.

## Solution

Merge the first branch, then resolve the second by combining rather than choosing.

```bash
git merge feature/cache-deps
git merge feature/security-scan     # conflict
```

The correctly resolved `.gitlab-ci.yml`:

```yaml
image: python:3.12-slim

stages:
  - test
  - scan
  - build

variables:
  PIP_INDEX_URL: "https://pypi.org/simple"
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.pip-cache"
  TRIVY_SEVERITY: "HIGH,CRITICAL"

cache:
  key: "$CI_COMMIT_REF_SLUG"
  paths:
    - .pip-cache/

test:
  stage: test
  script:
    - pip install --cache-dir "$PIP_CACHE_DIR" -r requirements.txt
    - pytest -q

scan:
  stage: scan
  script:
    - trivy fs --severity "$TRIVY_SEVERITY" --exit-code 1 .

build:
  stage: build
  script:
    - docker build -t app:$CI_COMMIT_SHA .
```

Complete the merge:

```bash
python3 -c "import yaml; yaml.safe_load(open('.gitlab-ci.yml')); print('valid')"
git add .gitlab-ci.yml
git commit          # git pre-fills a merge message; keep or extend it
git log --graph --oneline -n 5
```

Tools and habits that make this routine:

- `git mergetool` opens a three-way diff in your configured editor, showing base,
  ours and theirs side by side instead of inline markers.
- `git config merge.conflictStyle zdiff3` changes the markers to include the common
  ancestor inline. It is a genuine upgrade and worth setting globally — you can see
  what the original text was without running `git show :1:`.
- `git checkout --ours <file>` and `--theirs <file>` take an entire side. They are
  right for lockfiles and generated artefacts, and almost always wrong for
  hand-written config like this.
- If the branch had been rebased instead of merged, "ours" and "theirs" would be
  reversed relative to your intuition, because rebase replays your commits on top of
  theirs. Check with `git status` rather than assuming.

## What You Learned

Conflict resolution is a code review, not a text-editing chore. Git flags the
overlap; deciding what the combined intent should be is entirely a human judgement,
and it is the step people skip.

The verification habit is what separates a safe resolver from a dangerous one. After
every resolution, prove the artefact is well-formed and that each side's intended
behaviour is still present. In a pipeline file the cost of a wrong guess is a scan
stage that silently stops running, which nobody discovers until the audit.
