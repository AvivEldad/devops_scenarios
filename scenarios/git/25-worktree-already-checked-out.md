# worktree: branch already checked out

## Briefing

You try `git checkout feature` in a second clone of the same repo — or
`git worktree add` — and git refuses: `fatal: 'feature' is already checked out at
...`. Or you have two directories, both on `main`, and commits in one do not show
in the other because they are **two clones**, not worktrees, with two object
databases that drifted.

Worktrees share one `.git` and therefore one set of branch checkouts: a branch can
be HEAD in only one worktree. Extra clones do not share objects unless you fetch.

## Your Task

- Reproduce "branch already checked out" with `git worktree add`.
- Add a worktree on a new branch (or detach) so you can work in parallel.
- Contrast with a second clone that does not see unpushed commits.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab wt2
git init -q -b main lab
git -C lab config user.email "you@example.com"
git -C lab config user.name "You"
echo "v1" > lab/app.txt && git -C lab add app.txt && git -C lab commit -qm "v1"
echo "now: git -C lab worktree add ../wt2 main   -> already checked out"
```

## Expected Failure

```bash
bash setup.sh
git -C lab worktree add ../wt2 main
# fatal: 'main' is already checked out at '.../lab'
```

A second `git clone lab clone2` succeeds but:

```bash
echo "local only" >> lab/app.txt && git -C lab commit -qam "not pushed"
git -C clone2 log --oneline
# no "not pushed"     <- different object db
```

## Expected Outcome

A second worktree exists on another branch (or detached), sharing history.

```bash
git -C lab worktree add ../wt2 -b hotfix
# or: git worktree add ../wt2 HEAD~0 --detach

git -C lab worktree list
# /path/lab     <sha> [main]
# /path/wt2     <sha> [hotfix]
```

Commits in `lab` are immediately visible in `wt2` (`git log` sees the same
`.git`).

## Hints

### Hint 1 — One branch, one worktree

`git worktree list` shows every checkout. To work on `feature` elsewhere, either
`git switch -c` in the new worktree or free the branch in the first
(`git switch --detach` / another branch). `git worktree add ../wt2 feature` works
if `feature` is not already HEAD somewhere.

### Hint 2 — Clones vs worktrees

Worktrees: `git worktree add`, shared objects, shared stashes/config (mostly).
Clones: full extra copy, isolation, extra disk, need fetch/push to share. Use
worktrees for parallel branches of the same project; clones for separate remotes
or throwaway experiments you might `rm -rf`.

## Solution

Add a worktree on a new branch, not on `main` twice.

```bash
cd lab
git worktree add ../wt2 -b hotfix
git -C ../wt2 status
git worktree list
```

When done:

```bash
git worktree remove ../wt2
```

- **`locked` worktrees** (`git worktree lock`) survive accidental remove; unlock
  when finished.
- **Prune** (`git worktree prune`) after deleting a worktree directory by hand,
  or git still thinks it exists.
- **Hooks and `.git/config` are shared.** A test that writes config in one
  worktree affects the other — that is the point and the hazard.
- **Submodules in worktrees** need extra care (`git submodule update` per
  worktree).
