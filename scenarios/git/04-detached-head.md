# The commits that vanished after I switched branches

## Briefing

You checked out a specific commit to inspect a bug, then made a fix and committed it.
`git log` showed your work. You switched back to `main` to open a PR — and the commits
are gone. `git log` on `main` has none of them. The files look like they never changed.

You were on a **detached HEAD**: commits were created, but no branch pointed at them.
Switching away left them reachable only through the reflog.

## Your Task

- Reproduce commits made on a detached HEAD that disappear after `checkout main`.
- Find the commits again.
- Attach them to a named branch so they cannot vanish.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "v1" > app.txt && git add app.txt && git commit -qm "initial"
echo "v2" >> app.txt && git commit -qam "second"
# simulate: inspect an old commit, then work there
git checkout --detach HEAD~1
echo "hotfix" >> app.txt
git commit -qam "the fix that will vanish"
echo "now: git checkout main   (the hotfix is no longer on any branch)"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git status
# HEAD detached at <sha>
git log --oneline
# <sha> the fix that will vanish
# <sha> initial

git checkout main
git log --oneline
# <sha> second
# <sha> initial          <- hotfix is gone from every named branch
```

The commit exists in the object store; nothing named points at it. After enough time
(or `git gc`) it becomes genuinely unrecoverable.

## Expected Outcome

The hotfix is on a named branch and `main` can receive it.

```bash
git branch recover-hotfix <sha-of-hotfix>
git log --oneline recover-hotfix
# <sha> the fix that will vanish
# <sha> initial
```

`git status` on that branch is not detached:

```bash
git checkout recover-hotfix
git status
# On branch recover-hotfix
```

## Hints

### Hint 1 — Detached HEAD means no branch name

`git status` saying `HEAD detached at ...` means you are pointing at a commit, not a
branch. New commits update `HEAD` only. `git checkout main` (or `switch`) moves `HEAD`
to `main` and leaves those commits unnamed. `git reflog` still has them.

### Hint 2 — Name it before you leave

`git switch -c hotfix` *before* committing, or `git branch recover <sha>` after, both
create a pointer. `git reflog` shows `checkout: moving from ...` and the SHA of the
detached commits. Recover from there if you already left.

## Solution

Find the detached commits in the reflog and give them a branch.

```bash
git reflog
# <sha> HEAD@{1}: commit: the fix that will vanish
git branch recover-hotfix <sha>
git switch recover-hotfix
```

Or, next time, create the branch *before* committing:

```bash
git switch --detach HEAD~1
git switch -c hotfix          # now commits have a name
```

- **A commit is only as durable as the refs that point at it.** Branches and tags are
  named refs. Detached HEAD is an unnamed pointer — easy to lose.
- **`git reflog` is the local journal of `HEAD`.** Recover from it until gc expires the
  objects (default ~30 days for unreachable commits).
- **Never do real work on a detached HEAD.** If you meant to branch from an old commit,
  `git switch -c <name> <sha>` first.
- **`git fsck --lost-found`** finds dangling commits if reflog is gone, but reflog is
  the first tool.
