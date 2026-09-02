# I cloned the repo and it is empty

## Briefing

`git clone` succeeds. The directory has a `.git` folder and nothing else — or you are
on `master` while the team works on `main` (or the reverse). CI, docs, and every
README assume `main`. Your clone is "empty" because you are on the wrong default
branch, or you cloned a repo whose default branch has no commits and the work lives
on another branch.

Empty-looking clones are almost always a **default-branch mismatch**, not a failed
clone.

## Your Task

- Clone (or simulate) a repo where `HEAD` points at an empty or unused default branch.
- List remote branches and find where the files actually are.
- Check out the correct branch and set it as your local default.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf remote.git clone
git init -q --bare remote.git
git clone -q remote.git work
git -C work config user.email "you@example.com"
git -C work config user.name "You"
cd work
# historical default: master, empty
git checkout -qb master
git commit -q --allow-empty -m "empty root on master"
# real work is on main
git checkout -qb main
echo "the app" > app.txt
git add app.txt && git commit -qm "real work"
git push -q origin master main
# remote HEAD still points at master (empty-looking)
git symbolic-ref HEAD refs/heads/master
git push -q origin HEAD:refs/heads/master
cd ..
git -C remote.git symbolic-ref HEAD refs/heads/master
git clone -q remote.git clone
echo "cloned; look at clone/ — you are on master, app.txt is not there"
```

## Expected Failure

```bash
bash setup.sh
cd clone
git branch -vv
# * master   xxxx empty root on master
ls
# (no app.txt)

git log --oneline
# xxxx empty root on master
```

The clone worked. `HEAD` on the remote is `master`, which has only an empty commit.
`main` has the files.

## Expected Outcome

The working tree has the application and tracks `main`.

```bash
git fetch origin
git branch -r
# origin/HEAD -> origin/master
# origin/main
# origin/master

git switch main
ls
# app.txt

git status -sb
# ## main...origin/main
```

Optionally the remote default is corrected (if you own it):

```bash
git remote set-head origin -a
# origin/HEAD set to main     (once the server default is main)
```

## Hints

### Hint 1 — Clone follows origin/HEAD

`git clone` checks out whatever `refs/remotes/origin/HEAD` points at (the server's
default branch). `git branch -r` and `git log --all --oneline --decorate` show every
branch. `ls` only shows the checkout.

### Hint 2 — Empty ≠ failed

A bare-looking tree with `.git` present is a successful clone of an empty-ish
branch. `git ls-remote origin` lists every ref without cloning again. Switch to the
branch that actually has trees.

## Solution

Find remote branches and switch to the one with the work.

```bash
git branch -r
git log --all --oneline --decorate --graph
git switch main
ls
```

If you own the remote, set the default branch to `main` (GitHub: Settings → Default
branch; locally for a bare repo: `git symbolic-ref HEAD refs/heads/main`).

- **Default branch is a server setting**, not a git-universal law. `master` vs `main`
  still splits teams and tooling.
- **`git clone --branch main`** checks out a specific branch regardless of
  `origin/HEAD`.
- **`git remote set-head origin -a`** updates your local `origin/HEAD` to match the
  server after they rename the default.
- **Shallow/partial clones can also look empty** (`--filter=blob:none`, sparse
  checkout). `git sparse-checkout list` if files "should" be there and are not.
