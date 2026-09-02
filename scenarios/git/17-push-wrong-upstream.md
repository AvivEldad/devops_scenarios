# git push went to the wrong remote branch

## Briefing

You are on `feature/billing`. You `git push` and GitHub opens a PR against `main`
from `main` — or you overwrote `origin/main` with feature commits. Tracking was
wrong: the local branch was set to push to `origin/main`, or `push.default` is
`matching` and you pushed every same-named branch, or you typed `git push origin
main` while your work was on a feature.

Git pushes a refspec, not "whatever I am thinking about". `git status -sb` and
`git rev-parse --abbrev-ref @{upstream}` tell you the truth before you push.

## Your Task

- Reproduce a local branch whose upstream is the wrong remote branch.
- See where a push would go *before* pushing.
- Fix tracking and push only the intended ref.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf remote.git lab
git init -q --bare remote.git
git clone -q remote.git lab
git -C lab config user.email "you@example.com"
git -C lab config user.name "You"
cd lab
echo "v1" > app.txt && git add app.txt && git commit -qm "initial"
git push -q -u origin main
git checkout -qb feature/billing
echo "billing" > bill.txt && git add bill.txt && git commit -qm "billing"
# mistaken: track main
git branch -u origin/main
echo "status -sb will show feature/billing...origin/main"
echo "git push would update origin/main (or refuse, depending on config)"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git status -sb
# ## feature/billing...origin/main [ahead 1]

git push
# updates origin/main with billing commits  (if allowed)
# or: a PR from main including billing files
```

```bash
git rev-parse --abbrev-ref @{upstream}
# origin/main          <- you wanted origin/feature/billing
```

The work is on the right *local* branch name and the wrong *remote* destination.

## Expected Outcome

The local branch tracks `origin/feature/billing` and `git push` updates only that.

```bash
git status -sb
# ## feature/billing...origin/feature/billing

git push -u origin HEAD
# * [new branch]      HEAD -> feature/billing
```

`origin/main` does not contain `bill.txt` unless you merged.

## Hints

### Hint 1 — Read status -sb every time

`## branch...upstream` is the contract. `ahead 1` vs `origin/main` means your next
`git push` is about `main`. `git push -n` / `git push --dry-run` prints the refspec
without sending.

### Hint 2 — push.default and -u

`push.default=simple` (current default) pushes the current branch to its upstream
of the same name, and refuses if names differ. `matching` pushes every local branch
that has a same-named remote — a classic "I pushed 12 branches" surprise. Always
`git push -u origin HEAD` for a new feature once.

## Solution

Point upstream at the feature branch and push explicitly.

```bash
git push --dry-run origin HEAD:feature/billing
git push -u origin HEAD
git status -sb
# ## feature/billing...origin/feature/billing
```

If you already polluted `origin/main`, reset it on the server from the last good
SHA (coordinate) — do not force-push `main` casually.

- **Local name and remote name are independent.** `-u` / `--set-upstream-to` is
  what binds them.
- **`git push origin main` while on feature** still updates `main` if your feature
  is merged into the local `main` you are pushing — know which SHA you are sending
  (`git log origin/main..main`).
- **`HEAD:feature/billing`** is the unambiguous refspec: this commit, that name.
- **`--dry-run` is cheaper than an incident.** Use it when upstream looks wrong.
