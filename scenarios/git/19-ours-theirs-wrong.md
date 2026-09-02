# --ours kept the wrong side of the merge

## Briefing

You had a merge conflict, remembered that "ours is our branch", ran
`git checkout --ours conflicted.c` (or `--theirs`), committed, and shipped a
version that dropped the other side's entire feature. During a **merge**, `ours` is
the branch you had checked out (`HEAD`). During a **rebase**, `ours` is the branch
you are rebasing *onto* — the opposite of many people's intuition.

Choosing a whole file with `--ours`/`--theirs` throws away the other side's hunks
in that file. It is rarely what a conflicted source file needs.

## Your Task

- Merge two branches that conflict and apply `--ours` on the file.
- Show that the other branch's change is absent from the result.
- Resolve by combining both edits (or knowing which command flips ours/theirs).

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
printf 'line1\nshared\nline3\n' > app.py
git add app.py && git commit -qm "base"
git checkout -qb feature
printf 'line1\nfeature-change\nline3\n' > app.py
git commit -qam "feature: important"
git checkout main
printf 'line1\nmain-change\nline3\n' > app.py
git commit -qam "main: also important"
echo "now: git merge feature   then git checkout --ours app.py"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git merge feature
# CONFLICT (content): Merge conflict in app.py

git checkout --ours app.py
git add app.py
git commit -m "merge feature"
cat app.py
# line1
# main-change
# line3
#  <- feature-change is gone; the merge "succeeded"
```

GitHub shows a merge commit. The feature's line never made it. Tests on `main`
alone still pass.

## Expected Outcome

The file contains both intended edits (or a correct manual combination).

```bash
cat app.py
# line1
# main-change
# feature-change
# line3
# (or whatever the real combined meaning is)

git show :2:app.py     # ours stage
git show :3:app.py     # theirs stage
```

No conflict markers remain.

## Hints

### Hint 1 — Stages 1, 2, 3

Conflicted files have higher stages in the index: `git ls-files -u`. Stage 2 is
ours (`HEAD`), stage 3 is theirs (the branch being merged). `git show :2:path`
and `:3:path` let you see each side without guessing. `git checkout --ours`
copies stage 2 over the working tree — whole file.

### Hint 2 — Rebase flips the labels

In `git rebase main` (on feature), `--ours` is `main` (the new base) and
`--theirs` is your feature commit being applied. If you memorised "ours = my
branch" you will keep `main` and drop your work. Prefer editing the conflict
markers by hand, or `git mergetool`.

## Solution

Do not take the whole file. Combine the sides.

```bash
git merge --abort   # if you already committed the bad merge: reset and redo
git merge feature
# edit app.py to include both changes
git add app.py
git commit
```

Inspect first:

```bash
git show :2:app.py
git show :3:app.py
```

- **`--ours`/`--theirs` are whole-file hammers.** Right for generated lockfiles
  you truly want one side of; wrong for source.
- **Merge ours = HEAD. Rebase ours = upstream.** Say the SHA, not the pronoun.
- **`git log -1 -p` after the merge** should show a combined diff that includes
  both features. If the merge commit's diff is suspiciously small, you dropped a
  side.
- **rerere** can replay a *previous* resolution — including a bad one. `git rerere
  forget` if it keeps applying a mistake.
