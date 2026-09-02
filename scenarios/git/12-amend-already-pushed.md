# I amended a commit that was already pushed

## Briefing

You typo'd a commit message (or forgot a file), ran `git commit --amend`, then
`git push`. The push was rejected, or you added `--force` and a teammate's commit
disappeared. Amend rewrites the commit SHA. Once that SHA is on the remote, you are
rewriting **published** history.

Amending is safe only for commits nobody else has based work on. The error
`(non-fast-forward)` is git protecting the remote; `--force` turns off that
protection.

## Your Task

- Amend a commit that has already been pushed and reproduce the rejected push.
- Recover without destroying a teammate's later commit (use `--force-with-lease` or
  a new commit instead of rewrite).
- Know when amend is allowed.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf remote.git you teammate
git init -q --bare remote.git
git clone -q remote.git you
git -C you config user.email "you@example.com"
git -C you config user.name "You"
cd you
echo "v1" > app.txt && git add app.txt && git commit -qm "typo in mesage"
git push -q -u origin main
echo "now: git commit --amend -m 'typo in message'  then git push"
```

## Expected Failure

```bash
bash setup.sh
cd you
git commit --amend -m "typo in message"
git push
# ! [rejected]        main -> main (non-fast-forward)
# error: failed to push some refs
```

If you `git push --force` after a teammate pushed:

```bash
# teammate's commit is no longer on origin/main
git log origin/main --oneline
# only your amended SHA
```

The remote still had the old SHA as parent of later work. Force-pushing dropped that
parent from the branch.

## Expected Outcome

The remote accepts your change **without** silently deleting others' commits.

Preferred: do not amend published commits — add a new commit:

```bash
git commit --amend --no-edit   # undo this if you already amended locally
# actually:
git log -1                     # if already rewritten locally and not needed:
git reset --soft ORIG_HEAD     # if amend was the last action
# simpler path from the start: git commit -m "fix typo in previous message"
```

If you must rewrite a branch you alone use:

```bash
git push --force-with-lease origin main
# refuses if origin/main moved since your last fetch
```

`git log --oneline --graph --all` shows both SHAs until you drop the old one.

## Hints

### Hint 1 — Amend changes the SHA

`--amend` replaces HEAD with a new commit (same parent, new tree/message/author
date). The old commit is still in reflog (`HEAD@{1}`) locally but the remote still
has the old SHA. A normal push is a fast-forward check; rewrite is not a
fast-forward.

### Hint 2 — force-with-lease, not force

`--force` sets the remote branch to whatever you have, even if someone else pushed.
`--force-with-lease` fails if `origin/main` is not the SHA you last fetched — the
minimum safety for rewriting a personal branch. Shared `main` should almost never
be force-pushed; add a fixup commit instead.

## Solution

Do not amend commits that are already on the remote. If you already amended locally
and nobody else used the old SHA, push with lease. If others might have, reset and
use a new commit.

```bash
# if amend was a mistake and you have not force-pushed:
git reflog
git reset --hard ORIG_HEAD     # back to the published SHA (discards amend)
echo "note" >> app.txt
git commit -am "fix typo in earlier message"
git push
```

If it is your private feature branch and you intend to rewrite:

```bash
git fetch origin
git push --force-with-lease origin HEAD
```

- **Published history is a contract.** Message typos on `main` get a follow-up
  commit; they do not get `--amend` + `--force`.
- **`--force-with-lease` is the only force** that should be muscle memory. Plain
  `--force` is how teammate work vanishes.
- **`ORIG_HEAD` and reflog** undo a local amend. Use them before you push.
- **PR branches are often rewritten** (rebase, squash). That is OK if you are the
  only pusher; tell collaborators before you lease-push a shared feature branch.
