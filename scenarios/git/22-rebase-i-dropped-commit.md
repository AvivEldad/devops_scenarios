# interactive rebase dropped a commit and I continued anyway

## Briefing

You ran `git rebase -i main` to squash "fix typo" commits. The todo list had a
`drop` or you deleted a line by accident, or a `squash` targeted the wrong commit.
You finished the rebase, force-pushed, and a real feature commit is missing from
the branch. `git log` looks tidy and wrong.

Interactive rebase is a scripted rewrite. Every line you delete is a commit you
throw away from the new branch. The old SHAs remain in reflog until gc.

## Your Task

- Run an interactive rebase that drops a wanted commit (simulate by rebasing with
  `--onto` / `rebase -i` editor script).
- Recover the dropped commit from reflog.
- Replay it onto the cleaned branch.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "base" > app.txt && git add app.txt && git commit -qm "base"
git checkout -qb feature
echo "feat" > feat.txt && git add feat.txt && git commit -qm "feature: real work"
echo "typo" > n.txt && git add n.txt && git commit -qm "fix typo"
echo "more" >> feat.txt && git commit -qam "feature: more"
echo "simulate dropping 'feature: real work' during rebase -i"
# non-interactive equivalent: rebase onto main omitting that commit
KEEP=$(git rev-parse HEAD)
DROP=$(git rev-parse HEAD~2)
git rebase --onto main "$DROP" "$KEEP"
echo "log now may miss 'feature: real work' depending on range; see also GIT_SEQUENCE_EDITOR"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git log --oneline
# feature: more
# fix typo
# base
#  <- "feature: real work" not on the branch
ls feat.txt
# may still have later edits; feat.txt creation commit is gone from history
```

`git log -- feat.txt` cannot find the original add. A force-push at this point
publishes the hole.

## Expected Outcome

The dropped commit is back (cherry-picked or rebase redone), and `git log` includes
the real work.

```bash
git reflog | head
git cherry-pick <sha-of-feature-real-work>
git log --oneline
# includes feature: real work
```

Alternatively reset to pre-rebase and run `-i` correctly.

## Hints

### Hint 1 — reflog before force-push

`git reflog` shows `rebase -i (start)` and the original feature tip. `git reset
--hard <that-sha>` undoes the whole rebase. Prefer that over reconstructing if you
have not added new work on the broken result.

### Hint 2 — Read the todo list

`pick` / `reword` / `squash` / `fixup` / `drop` / `edit`. Deleting a line = drop.
`squash` folds into the **previous** pick — squash the first commit in the list is
invalid. `GIT_SEQUENCE_EDITOR=true` keeps the list; `GIT_SEQUENCE_EDITOR="sed -i
'/real work/d'"` is how drops happen in automation.

## Solution

Find the pre-rebase tip or the dropped SHA; restore.

```bash
git reflog
# abc123 HEAD@{n}: rebase -i (start): checkout main
# def456 HEAD@{n+1}: commit: feature: more     <- old tip

git reset --hard def456          # full undo if that is simpler
# or:
git cherry-pick <sha-of-dropped>
```

- **Interactive rebase is a rewrite of the reachable list.** The todo is the
  complete set of commits that will exist afterwards (plus squash results).
- **Do not force-push until `git log --oneline main..HEAD` looks right.** Count
  commits; diff against the old SHA (`git diff oldtip...HEAD`).
- **`fixup` vs `squash`:** both fold; squash opens an editor for the message,
  fixup keeps the *picked* commit's message.
- **`rebase --abort`** only works during the rebase. After `rebase --continue`
  finishes, reflog is the undo.
