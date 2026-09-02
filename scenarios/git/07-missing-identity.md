# Every commit is owned by someone else

## Briefing

You committed on a new laptop (or a CI image, or a container). `git log` shows
`Author: root <root@localhost>` or git refused to commit at all:

```
Author identity unknown
*** Please tell me who you are.
```

Git will not guess. Without `user.name` and `user.email` it either blocks the commit
or, if some wrapper set dummy values, attributes your work to a fake identity. Hooks,
`Signed-off-by`, and `git blame` all depend on this being right.

## Your Task

- Reproduce a commit that fails for missing identity, or succeeds with a bogus one.
- Set `user.name` and `user.email` at the right scope (this repo vs global).
- Rewrite the bad commit's author if it already happened locally.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
# simulate a machine with NO identity configured
git config --local --unset-all user.name  2>/dev/null || true
git config --local --unset-all user.email 2>/dev/null || true
# hide global identity for this demo by overriding with empty via env in the notes
echo "app" > app.txt
git add app.txt
echo "now: GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git commit -m 'first'"
```

## Expected Failure

```bash
bash setup.sh
cd lab
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git commit -m "first"
# Author identity unknown
# *** Please tell me who you are.
#  git config --global user.email "you@example.com"
#  git config --global user.name "Your Name"
```

Or, if a container image set placeholders:

```bash
git log -1 --format='%an <%ae>'
# root <root@localhost>
```

The commit either never happened, or it happened under an identity that is not you —
which you will have to rewrite before anyone reviews it.

## Expected Outcome

Commits carry your real name and email.

```bash
git config user.name
# Your Name
git config user.email
# you@example.com

git commit -m "first"
git log -1 --format='%an <%ae>'
# Your Name <you@example.com>
```

A previously wrong local commit is rewritten:

```bash
git commit --amend --reset-author --no-edit
git log -1 --format='%an <%ae>'
# Your Name <you@example.com>
```

## Hints

### Hint 1 — Scope matters

`git config --global` writes `~/.gitconfig` (all repos on this machine).
`git config` / `--local` writes `.git/config` (this repo only). Use local for
work-vs-personal email on the same laptop. `git config --show-origin user.email`
tells you which file is winning.

### Hint 2 — Amend only if it has not been pushed

`git commit --amend --reset-author` rewrites HEAD using your current identity. If
you already pushed, amending rewrites published history — coordinate, or use
`git commit --fixup` / a follow-up rather than force-pushing just for a name typo
on a shared branch.

## Solution

Set identity, then commit (and amend the dummy author if needed).

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
# or --local for this repository only

GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null true  # (demo only)
git -c user.name="Your Name" -c user.email="you@example.com" commit -m "first"

# if a bad commit already exists locally:
git commit --amend --reset-author --no-edit
```

- **Git does not invent an author.** Missing config is a hard fail (modern git); dummy
  values from images are worse because they succeed silently.
- **`--show-origin` is the debug tool** when the email is unexpectedly your old job
  or `root@localhost`.
- **CI should set identity explicitly** (`git config user.email ci@org` in the job) so
  release tags are not `runner@fv-az`.
- **Author vs committer:** rebase/cherry-pick preserve author and update committer.
  `--reset-author` updates both. Know which one you are looking at (`%an` vs `%cn`).
