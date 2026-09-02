# I deleted the file but git still has it

## Briefing

You `rm`'d a generated file (or a secret, or `dist/`) and it is gone from the
working tree. `git status` says nothing, or says `deleted` but after commit the
file is still in the repo for anyone who checks out an old tag. Or you `git rm --cached`
and the next person still has it because you never committed the removal.

`rm` only deletes the working-tree copy. Git continues to track the path until
`git rm` (or `git rm --cached`) is committed. History still contains the blob
until you rewrite (see the committed-secret scenario).

## Your Task

- Remove a tracked file with `rm` only and see git restore it (or keep tracking).
- Stop tracking it, keep or drop the working copy as appropriate, and commit.
- Ignore it so it does not come back.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "build artifact" > dist.js
echo "src" > app.js
git add dist.js app.js && git commit -qm "oops tracked dist"
echo "now: rm dist.js   then later git checkout -- dist.js restores it"
```

## Expected Failure

```bash
bash setup.sh
cd lab
rm dist.js
git status
# deleted: dist.js          <- git still tracks it; the next checkout brings it back

git checkout -- dist.js
cat dist.js
# build artifact            <- "I deleted that"
```

If you add `dist.js` to `.gitignore` without `git rm --cached`:

```bash
echo dist.js >> .gitignore
git status
# still shows dist.js as tracked; gitignore does not apply to tracked files
```

## Expected Outcome

The file is not in the next commit's tree; gitignore prevents re-adding.

```bash
git ls-tree -r HEAD --name-only
# app.js
# (no dist.js)

cat .gitignore
# dist.js

git status
# nothing to commit, working tree clean
```

The working copy may still exist if you used `--cached` (for secrets you still
need locally).

## Hints

### Hint 1 — Tracked files ignore gitignore

`.gitignore` only affects **untracked** paths. Once a file is in the index, you
must `git rm --cached <path>` (keep disk) or `git rm <path>` (delete disk + index)
and commit. `git ls-files --stage dist.js` proves it is still tracked.

### Hint 2 — History still has the blob

Removing from HEAD does not purge old commits. For secrets, that is a history
rewrite problem (filter-repo). For build artifacts, stopping the tracking is
usually enough; old tags may still contain `dist.js`.

## Solution

Remove from the index, ignore, commit.

```bash
git rm --cached dist.js          # keep file on disk if you still need it
# or: git rm dist.js             # delete from disk too
echo dist.js >> .gitignore
git add .gitignore
git commit -m "stop tracking dist.js"
git ls-files --stage dist.js     # empty
```

- **`rm` is not `git rm`.** The working tree is not the database.
- **`git rm --cached` is the "stop tracking but keep my copy"** tool — the usual
  fix for accidental `dist/` or `.env` adds.
- **Commit the removal.** Until you do, clones of the current HEAD still have the
  file, and `git checkout` will restore it.
- **Purging history is a separate, destructive step.** Do not confuse "not in HEAD"
  with "not in the repo".
