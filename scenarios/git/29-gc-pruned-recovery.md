# gc deleted the commit I was going to recover

## Briefing

You `reset --hard` yesterday, did not create a branch, then ran `git gc --prune=now`
(or a nightly maintenance gc ran). Today `git reflog` still shows the SHA but
`git show <sha>` says `bad object`. Or reflog expired (`gc.reflogExpireUnreachable`)
and `fsck` finds nothing. Recovery has a deadline: reflog expiry then prune.

This is the expert edge of the "lost commits" beginner scenario: you waited too
long or forced prune.

## Your Task

- Create unreachable commits, expire reflog / prune, and see the object vanish.
- Recover *before* prune using reflog or `fsck --lost-found`.
- Set reflog expiry so "undo" remains possible for a sane window.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "keep" > a.txt && git add a.txt && git commit -qm "keep"
echo "precious" > a.txt && git commit -qam "precious work"
PRE=$(git rev-parse HEAD)
git reset --hard HEAD~1
echo "PRE=$PRE still in reflog; after gc --prune=now it may die if we expire first"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git reflog expire --expire=now --expire-unreachable=now --all
git gc --prune=now
git show "$PRE"
# fatal: bad object <sha>
```

Before expire, `git show $PRE` still works even after `reset --hard`.

## Expected Outcome

You recover while the object still exists, then configure expiry that matches how
you actually work.

```bash
git reflog
git checkout -b recovered <sha>
git show recovered:a.txt
# precious
```

Config (example):

```bash
git config gc.reflogExpire 90.days
git config gc.reflogExpireUnreachable 30.days
```

Do not `gc --prune=now` on a repo you might still need to undo.

## Hints

### Hint 1 — Two clocks

Reflog expiry (`gc.reflogExpireUnreachable`, default 30 days for unreachable)
drops the *name*. `gc --prune` (default 2 weeks for loose objects, and packed
unreachable later) drops the *bytes*. Either can make recovery impossible.
`git fsck --lost-found` helps only while the object is still in the object
database.

### Hint 2 — Other copies

The SHA on GitHub, another clone, CI artifacts, or `git bundle` is a backup. If
you pushed before the reset, `git fetch origin && git show origin/main` (or the
old PR branch) is easier than fsck.

## Solution

Branch the SHA immediately; never prune in a panic.

```bash
git reflog
git branch recovered <sha>
# if SHA unknown:
git fsck --unreachable --no-reflogs | grep commit
```

If already pruned, search other clones and hosting. If none, it is gone.

- **Treat `gc --prune=now` as data destruction** unless you know nothing
  unreachable matters.
- **Default 30 days** is why "I reset last month" sometimes still works. Corporate
  images that set expire to `1.day` surprise people.
- **`git stash` and dangling blobs** (`git fsck --lost-found`) recover staged-but-
  never-committed files more often than people expect — until prune.
- **Push or branch before experiments.** Named refs are the only durable
  protection.
