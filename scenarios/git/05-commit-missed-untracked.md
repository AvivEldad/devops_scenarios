# The commit that succeeded and left the new files behind

## Briefing

You created `deploy.sh` and `config/prod.env`, ran `git commit -am "add deploy"`, and
the commit succeeded. A teammate clones the repo and neither file is there. `git show`
on your commit only lists changes to files that were *already tracked*.

`git commit -a` (and `-am`) stages modifications and deletions of **tracked** files
only. Untracked files are silently left out. The commit message looks like you added
them; git never saw them.

## Your Task

- Reproduce a commit that "succeeds" while new files stay untracked.
- Confirm they are absent from the commit.
- Add them properly and verify they are in history.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "app" > app.py && git add app.py && git commit -qm "initial"
mkdir -p config
echo "deploying" > deploy.sh
echo "PROD=1" > config/prod.env
echo "now: git commit -am 'add deploy'   (new files will NOT be in the commit)"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git commit -am "add deploy"
# [main xxxx] add deploy
#  1 file changed, 0 insertions(+), 0 deletions(-)   # or: nothing to commit
```

If `app.py` was unchanged, git may say `nothing to commit, working tree clean` *even
though* `git status` still lists untracked files — or it commits only tracked edits.

```bash
git status
# Untracked files:
#   config/prod.env
#   deploy.sh

git show --stat HEAD
# (neither new file listed)
```

## Expected Outcome

The new files are in the latest commit.

```bash
git add deploy.sh config/prod.env
git commit -m "add deploy"
git ls-tree -r HEAD --name-only
# app.py
# config/prod.env
# deploy.sh
```

`git status` is clean:

```bash
git status
# nothing to commit, working tree clean
```

## Hints

### Hint 1 — -a never picks up untracked files

`git commit -a` is "commit all *tracked* changes". New files need `git add` first.
`git status` is the check: anything under **Untracked files** is not going into the
next `-am` commit. `git add -A` (or `git add .`) stages new, modified, and deleted.

### Hint 2 — Look at the commit, not the working tree

`git show --stat HEAD` and `git ls-tree -r HEAD` show what actually landed. A clean
working tree after `-am` can still mean new files were never added — they remain
untracked and `status` is *not* clean. Read status before you assume the commit did
what the message says.

## Solution

Stage the untracked files, then commit.

```bash
git status                  # see Untracked files
git add deploy.sh config/prod.env
# or: git add -A
git commit -m "add deploy"
git ls-tree -r HEAD --name-only
```

- **`-a` / `-am` skip untracked files.** This is the most common "I committed it but
  it's not in the repo" cause.
- **`git add` is the only way new files enter the index.** Habit: `git status` then
  `git diff --cached` before every commit.
- **`git add -A` vs `git add .` vs `git add -u`:** `-A` is the whole tree (new +
  modified + deleted); `.` is from this directory down; `-u` is tracked-only (like
  `-a`).
- **Commit messages are not evidence.** `git show` is. Never trust a message that
  says "add X" without checking the tree.
