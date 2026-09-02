# git bisect blamed a merge commit and I stopped looking

## Briefing

A bug appeared "sometime last month". You ran `git bisect` and it landed on a giant
merge commit, or a commit that only changes whitespace, or it skipped so many
commits that the answer is useless. Bisect works if **every** `good`/`bad` test is
accurate and the bug is a single introduction. Merge commits, flaky tests, and
"cannot build this SHA" skip-chains make it lie.

Bisect is binary search over history. The result is only as good as the test you
run at each step.

## Your Task

- Bisect a history where the bug is in a real commit, not the merge.
- Write a test script that exits 0 (good) / 1 (bad) / 125 (skip).
- Name the first bad *change*, not just the merge that brought it in.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "ok" > app.py && git add app.py && git commit -qm "good"
git checkout -qb feature
echo "bug" > app.py && git commit -qam "feature: introduce bug"
echo "n" > n.txt && git add n.txt && git commit -qm "feature: unrelated"
git checkout main
echo "mainline" > other.py && git add other.py && git commit -qm "main work"
git merge --no-edit -m "merge feature" feature
echo "later" >> other.py && git commit -qam "after merge"
echo "bug is in 'feature: introduce bug'; naive bisect may land on the merge"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git bisect start
git bisect bad HEAD
git bisect good HEAD~4     # or the first commit
# ... test: grep -q bug app.py; echo $?
git bisect good / bad
# Bisecting: a merge commit
# <sha> merge feature          <- this is WHEN it arrived on main, not the cause
```

If your test is "does `main`'s tree have the bug?", the merge is the first bad
commit on `main`. The actual introduction is on the feature branch.

## Expected Outcome

You identify `feature: introduce bug` as the introducing commit.

```bash
git bisect start
git bisect bad HEAD
git bisect good <sha-of-ok>
git bisect run grep -q bug app.py
# (invert: grep is 0 when bug PRESENT, so use a script that fails when bug exists)
```

Better: `git show <merge>^2` / `git log -S bug --oneline` to jump to the real
commit once bisect names a merge.

```bash
git log -S bug --oneline -- app.py
# feature: introduce bug
```

## Hints

### Hint 1 — First bad on this line vs first introducing change

Bisect answers "first commit in *this* range that fails the test". For a merge-based
workflow, that is often the merge. `git log BAD^1..BAD^2` (the incoming side) and
`git log -S` / `git blame` find the real hunk. `git bisect` with a range that
includes the feature branch (`git bisect good <feature-base>`) can land inside it.

### Hint 2 — skip and flaky tests

Exit `125` from `git bisect run` to skip unbuildable SHAs. A flaky test that
randomly fails will mark good commits bad and the result is garbage — make the
predicate deterministic. `git bisect reset` to abort.

## Solution

Use bisect, then if the result is a merge, walk the incoming parent.

```bash
git bisect start HEAD <good-sha>
# test script: exit 1 if bug present
git bisect run bash -c 'grep -q "^bug$" app.py && exit 1 || exit 0'

# if it names a merge:
git log --oneline <merge>^1..<merge>^2
git log -S bug --oneline -- app.py
git bisect reset
```

- **Bisect finds a boundary, not a motive.** A merge boundary means "look inside
  the merged branch".
- **`-S` / `-G` pickaxe** is often faster than bisect when you know a string that
  appeared.
- **`bisect run` must be deterministic.** Flakes and network tests do not belong
  here; a unit test that asserts the bug is ideal.
- **`125` skip** keeps the search valid when old SHAs cannot run. Too many skips
  widen the remaining range — say so in the result.
