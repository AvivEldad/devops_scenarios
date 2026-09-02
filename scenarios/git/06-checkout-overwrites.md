# checkout ate my uncommitted work

## Briefing

You had local edits you had not committed. You ran `git checkout other-branch` (or
`git switch`) to look at something, and git refused — or, with `--force` / a path
checkout, the edits vanished. You cannot get them back from `git log` because they
were never a commit.

Uncommitted work lives only in the working tree and the index. Switching branches
with conflicting changes is blocked *unless* you force it or check out specific
paths. Forced checkout discards those changes.

## Your Task

- Make local edits, switch branches the unsafe way, and lose the work.
- Explain where uncommitted changes live and why log cannot recover them.
- Practice the safe alternatives: stash, commit, or switch with a new branch.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "main" > app.txt && git add app.txt && git commit -qm "on main"
git checkout -qb feature
echo "feature" > app.txt && git commit -qam "on feature"
git checkout main
echo "IMPORTANT local fix" > app.txt     # uncommitted
echo "now: git checkout --force feature   (or git restore --source=feature --worktree -- app.txt)"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git checkout feature
# error: Your local changes to the following files would be overwritten by checkout:
#     app.txt
# Please commit your changes or stash them before you switch branches.

git checkout --force feature
cat app.txt
# feature                                 <- "IMPORTANT local fix" is gone
git log -p -1
# does not contain "IMPORTANT local fix" — it was never committed
```

Forced checkout replaced the working tree with `feature`'s version. Uncommitted text
is not in any object git keeps by default.

## Expected Outcome

You can switch branches without discarding uncommitted work.

Using stash:

```bash
git stash push -m "local fix"
git switch feature
git switch main
git stash pop
cat app.txt
# IMPORTANT local fix
```

Or commit on a WIP branch:

```bash
git switch -c wip-local-fix
git commit -am "wip: local fix"
```

`reflog` is not required because the work was never thrown away.

## Hints

### Hint 1 — Git blocks checkout to protect you

The error is the feature. `checkout --force` / `restore --worktree` / `reset --hard`
are the commands that actually destroy uncommitted work. If you have not committed or
stashed, **nothing in git history can recover it**. Editor local history is the only
maybe.

### Hint 2 — Stash or commit before you switch

`git stash` snapshots the working tree and index onto a stack; `git switch` then
works. `git switch -c wip` commits the work on a throwaway branch — often clearer
than stash. `git stash show -p` / `git stash list` if you already stashed and cannot
find it.

## Solution

Do not force the checkout. Stash or commit first.

```bash
# recover only if you have NOT yet forced:
git diff                        # still there
git stash push -u -m "local fix"
git switch feature
# ... later
git switch main
git stash pop
```

If you already forced, check the editor's local history; git cannot help.

- **Uncommitted work is not in the object database.** Commits, stash reflog, and
  occasionally dangling blobs from `git add` are recoverable; raw working-tree edits
  after `--force` are not.
- **`git stash` is a commit** (two, actually: index + worktree) on `refs/stash`. It
  *is* recoverable via `git stash list` / `git fsck` until dropped and gc'd.
- **Prefer `git switch -c wip` for anything you might want tomorrow.** Stash is easy
  to `stash drop` by accident.
- **Read the overwrite error as a stop sign**, not a prompt to add `--force`.
