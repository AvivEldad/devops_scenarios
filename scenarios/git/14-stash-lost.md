# stash pop destroyed my working tree

## Briefing

You `git stash`'d, switched branches, did other work, came back, and `git stash pop`
produced conflicts — or popped the wrong stash, or `stash drop`d the one you needed.
`git stash list` is now empty and the code you stashed is not in the working tree.

Stash is a stack of commits. `pop` applies then **drops** that stash. A conflict
during pop still drops in some older git versions; in current git the stash is kept
on conflict. `drop` / `clear` are how stashes actually die. The stash reflog can
still save you.

## Your Task

- Put real work in a stash, pop it on a conflicting tree (or drop it).
- Recover the stash from the stash reflog if the list is empty.
- Apply the correct stash without losing it until you confirm.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "v1" > app.txt && git add app.txt && git commit -qm "v1"
echo "my uncommitted work" > app.txt
git stash push -m "wip: important"
echo "v2 from main" > app.txt && git commit -qam "v2"
echo "now: git stash pop   (conflicts)  or  git stash drop"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git stash pop
# Auto-merging app.txt
# CONFLICT (content): Merge conflict in app.txt
git stash list
# stash@{0}: WIP on main: ...     (kept on conflict in modern git)

# the dangerous sequence:
git stash drop                     # or pop that succeeded on the wrong branch
git stash list
# (empty)
cat app.txt
# v2 from main                    <- wip text gone from the tree
```

If you resolved the conflict badly and committed, the stash may already be dropped
and the WIP is only in the stash reflog.

## Expected Outcome

The stashed work is recovered and applied cleanly (or on a dedicated branch).

```bash
git fsck --unreachable | head    # optional
git stash list
# stash@{0}: On main: wip: important

git stash apply stash@{0}
# fix conflicts if any
git stash drop stash@{0}         # only after the tree looks right
```

Or recover after drop:

```bash
git fsck --no-reflog | grep commit
# or:
git log --walk-reflogs --oneline refs/stash
git stash apply <sha>
```

## Hints

### Hint 1 — apply, then drop yourself

`git stash apply` applies without deleting. `git stash pop` is apply + drop. Use
`apply` until you have seen the result. `git stash show -p stash@{0}` previews
without touching the tree.

### Hint 2 — The stash reflog outlives `stash list`

`git stash drop` removes the ref from the list but the commit is often still in
`refs/stash` reflog: `git log -g refs/stash`. `git fsck --unreachable` finds
dangling stash commits. Recover with `git stash apply <sha>` or `git branch recovered
<sha>`.

## Solution

Preview, apply, resolve, then drop. If already dropped, use the stash reflog.

```bash
git stash show -p stash@{0}
git stash apply stash@{0}
# resolve app.txt if needed
git stash drop stash@{0}
```

After an accidental drop:

```bash
git log -g --oneline refs/stash
git stash apply <sha-from-reflog>
```

- **Stash is not a backup you can forget.** Name it (`-m`) and prefer a WIP commit on
  a branch for anything that must survive the weekend.
- **`pop` on the wrong branch** applies in the wrong place — `apply` + inspect
  `git diff` first.
- **`git stash push -u` includes untracked files**; default stash does not. That is
  how "I stashed but new files are still here / vanished" happens.
- **`stash clear` is almost never what you want.** It drops the entire stack.
