# cherry-pick says empty and the bug is still there

## Briefing

You cherry-picked a hotfix from `main` onto a release branch. Git reported
`The previous cherry-pick is now empty` or succeeded but the production bug remains.
Either the patch was already in the branch (duplicate), git skipped it, or you
cherry-picked a merge commit and got only one parent’s diff — the wrong one.

Cherry-pick applies a **diff**. If that diff does not apply (already present, or
context changed), you get empty/skip/conflict. Merge commits have two diffs; the
default parent is often not the change you meant.

## Your Task

- Cherry-pick a commit that is already contained, or a merge commit, and see skip/
  empty/wrong tree.
- Identify what cherry-pick actually applied with `git show` / `git diff`.
- Apply the intended change (right parent, or a real commit that is not a merge).

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
git checkout -qb release
echo "rel" >> app.txt && git commit -qam "release line"
git checkout main
echo "hotfix" >> app.txt && git commit -qam "hotfix: the actual fix"
HOTFIX=$(git rev-parse HEAD)
# merge hotfix into release already (so a later cherry-pick is empty)
git checkout release
git merge --no-edit -m "merge hotfix" main || {
  echo "hotfix" > app.txt
  git add app.txt
  git commit -qm "merge hotfix"
}
echo "HOTFIX=$HOTFIX"
echo "now on release: git cherry-pick $HOTFIX"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git checkout release
git cherry-pick "$HOTFIX"
# The previous cherry-pick is now empty, possibly due to conflict resolution.
# If you wish to commit it anyway, use:
#     git commit --allow-empty
# Otherwise, please use 'git cherry-pick --skip'
```

Or for a merge commit:

```bash
git cherry-pick <merge-sha>
# error: commit <sha> is a merge but no -m option was given.
```

With `-m 1` you may apply the inverse of what you wanted.

## Expected Outcome

The release branch contains the hotfix content, and you can explain *which* diff
was applied.

```bash
git log --oneline release
# includes the hotfix or an equivalent patch

grep hotfix app.txt
# hotfix
```

If the pick was empty because it was already merged, `--skip` is correct — verify
with `git blame` / `git log -S hotfix`.

## Hints

### Hint 1 — Empty means the patch is already in HEAD

`git cherry-pick --skip` is right when `git show <sha>`’s hunks are already in the
file. Confirm with `git log -p -S hotfix -- app.txt`. Do not `--allow-empty` just to
clear the state — that records a lie.

### Hint 2 — Merge commits need -m

`git cherry-pick -m 1 <merge>` uses parent 1 as the base (usually the branch you
merged *into*). `-m 2` uses the incoming branch. `git show <merge>` tells you the
parents. Prefer cherry-picking the original non-merge hotfix commit, not the merge.

## Solution

Inspect why it is empty; skip or pick the non-merge commit with the right parent.

```bash
git show "$HOTFIX"
git log -S hotfix --oneline
git cherry-pick --skip          # if already present

# merge commit case:
git log --merges -1 --format=%P
git cherry-pick -m 1 <merge>    # only after you know which parent is correct
# better:
git cherry-pick <original-hotfix-sha>
```

- **Cherry-pick is a patch apply**, not “make this SHA exist on my branch”. Duplicate
  SHAs are normal; equivalent diffs may already be there via merge.
- **Never cherry-pick merges unless you understand `-m`.** Teams that merge PRs
  should pick the PR’s commit(s), not the merge bubble.
- **`git cherry-pick --abort`** if you are lost. Empty + skip is a successful
  no-op, not a failure of git.
- **`git log --cherry-mark --left-right main...release`** visualises which patches
  are unique to each side.
