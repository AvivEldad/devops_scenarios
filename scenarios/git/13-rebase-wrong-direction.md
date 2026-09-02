# rebase turned my PR into a 40-commit mess of someone else's work

## Briefing

You were asked to "rebase onto main" before merge. You ran `git rebase main` (or
`git pull --rebase origin main`) and now `git log` on your branch shows dozens of
commits you did not write, the PR diff is huge, and GitHub says the branch cannot
be rebased cleanly. You may have rebased the wrong way — **rebased main onto your
feature** instead of your feature onto main — or continued through conflicts by
taking the wrong side.

A rebase replays *your* commits on top of a new base. If you replay `main` onto
`feature`, you duplicate half the project's history onto your branch.

## Your Task

- Reproduce a rebase that copies `main`'s commits onto a feature branch (or a
  conflict resolved with the wrong side).
- Restore the feature branch to "my work, on top of current main".
- Confirm the PR would show only your files.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "base" > app.txt && git add app.txt && git commit -qm "base"
git checkout -qb feature
echo "mine" > feat.txt && git add feat.txt && git commit -qm "my feature"
git checkout main
echo "theirs" > core.txt && git add core.txt && git commit -qm "main: core"
echo "main: more" >> core.txt && git commit -qam "main: more"
git checkout feature
echo "WRONG: git rebase feature main   (replays main onto feature)"
echo "RIGHT: git rebase main           (while on feature)"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git checkout main
git rebase feature          # backwards: replay main's commits onto feature
git log --oneline --decorate
# main now has: main commits on top of feature — or you did this on feature:
git checkout feature
git rebase --onto feature main feature   # similarly confused
```

A common mix-up:

```bash
git checkout feature
git rebase feature main     # first arg is <upstream> when 2 args... 
# git rebase <upstream> <branch>  checks out <branch> and rebases onto <upstream>
```

Wrong argument order produces a branch that contains the other line of work
duplicated. The PR lists files you never touched.

## Expected Outcome

`feature` has your commit(s) with `main` as ancestor; `git log main..feature` is
only your work.

```bash
git log --oneline main..feature
# <sha> my feature

git merge-base main feature
# equals main's tip (feature is fully rebased)
```

`git diff main...feature` shows only `feat.txt`.

## Hints

### Hint 1 — Read the rebase arguments

`git rebase main` (while on `feature`) = take commits reachable from HEAD but not
from `main`, replay them onto `main`. `git rebase main feature` does the same after
checking out `feature`. Reversing the names replays the wrong set. `git log
--oneline --graph --decorate main feature` before and after.

### Hint 2 — Abort is your friend

`git rebase --abort` during a bad rebase returns you to the pre-rebase SHA
(`ORIG_HEAD` / reflog `rebase: abort`). If you already finished, `git reflog` and
`git reset --hard <sha-before-rebase>`. Then rerun the correct command.

## Solution

Reset the confused branch and rebase in the right direction.

```bash
git reflog | head
git reset --hard <sha-of-feature-before-bad-rebase>
git fetch origin            # if main moved
git rebase main             # ON feature
git log --oneline --graph --decorate main feature
```

- **Rebase copies commits.** Direction is everything: your unique commits go onto
  the new base, not the other way around.
- **`main..feature` should be *your* commits only** after a successful rebase onto
  main. If that range is huge, the rebase was backwards or you included merge
  commits you did not mean to replay (`--rebase-merges` / flatten).
- **Never rebase a branch others are using** without agreement — same as amend. For
  shared branches, merge main into feature instead.
- **Conflict markers: `ours` during rebase is the branch you are replaying onto**
  (the new base), which is the opposite of what people expect from merge. Read
  `git checkout --ours` docs before you use it mid-rebase.
