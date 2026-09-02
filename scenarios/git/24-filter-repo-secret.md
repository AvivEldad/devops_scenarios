# git filter-repo is the only way this secret leaves history

## Briefing

A secret was committed months ago, then "removed" in a later commit. Every clone
still has it (`git log -p -- secrets.env`). `git rm` and a new commit do not rewrite
the old trees. You need a history rewrite (`git filter-repo` or BFG), a force-push
of every branch/tag, and **rotation of the secret** — rewrite without rotation is
theatre.

This is the expert counterpart to the beginner "gitignore does nothing" scenario:
you already un-tracked the file; the object is still in the pack.

## Your Task

- Show the secret is still reachable from an old commit.
- Rewrite history so a fresh clone of the new history does not contain the file
  (understand the command; running filter-repo on a throwaway clone is enough).
- List the operational follow-ups: rotate, force-push refs, tell everyone to reclone.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "TOKEN=sk-live-aaa" > secrets.env
echo "app" > app.py
git add secrets.env app.py && git commit -qm "add app and secrets"
echo "TOKEN=redacted" > secrets.env
git add secrets.env && git commit -qm "remove secret from working tree"
echo "git log -p -- secrets.env  still shows sk-live-aaa"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git log -p -- secrets.env
# includes +TOKEN=sk-live-aaa
git rev-list --all -- secrets.env
# two commits
```

Anyone with the clone can `git show HEAD~1:secrets.env`. GitHub search and
`trufflehog` will find it too.

## Expected Outcome

After a rewrite on a **throwaway** clone, the file is gone from all revisions you
rewrote, and you treat the token as leaked.

```bash
git log --all -- secrets.env
# (empty)

git grep -n sk-live-aaa $(git rev-list --all) || echo "not in rewritten history"
```

You also rotated `sk-live-aaa` in the real system (out of band).

## Hints

### Hint 1 — Removing from HEAD is not removing from git

`git rev-list --all -- path` and `git log --all -p -- path` are the tests. Filter
until those are empty. `filter-branch` is obsolete; `git filter-repo
--path secrets.env --invert-paths` is the current tool (install separately).

### Hint 2 — Rewrite is a new repository from everyone else's point of view

Every SHA changes. All branches and tags must be pushed with lease/force. Everyone
re-clones or `git fetch` + reset. Open PRs break. Do this once, with a
communications plan. Rotate the credential **before** or immediately as you
publish; the old packs are already copied.

## Solution

On a mirror clone, strip the path, then force-push all refs (lab only).

```bash
# install git-filter-repo first
git clone --mirror lab lab.git
cd lab.git
git filter-repo --path secrets.env --invert-paths
# verify
git log --all -- secrets.env

# production: rotate the token, then
# git push --force --tags origin 'refs/heads/*'
```

Without filter-repo, a new orphan branch that never had the file is a last resort
for small repos (`git checkout --orphan`).

- **Assume the secret is public** the moment it was pushed. Rewrite is hygiene;
  rotation is the fix.
- **`--invert-paths` drops a path from every commit.** `--replace-text` can redact
  in-file secrets if the file must stay.
- **Never filter-repo a directory you still need as your only copy.** Work on a
  clone; keep the original until you verify.
- **GitHub "remove from history" docs** include expunging caches and Actions logs.
  Packs on forks are out of your control.
