# force push erased a teammate's commit

## Briefing

You rebased your feature branch, `git push --force`, and a commit a teammate had
pushed to the same branch is gone from GitHub. They still have it locally. `git log
origin/feature` no longer shows their SHA.

`--force` sets the remote ref to your local SHA regardless of what it pointed at.
`--force-with-lease` refuses if the remote moved. Recovering the teammate's commit
uses their machine, the remote reflog (GitHub events), or `git fetch` of another
clone — not `git log` on the rewritten branch.

## Your Task

- Simulate two people on one branch; force-push and drop the other's commit.
- Recover that commit and put it back on the branch.
- Replace `--force` with `--force-with-lease` in the workflow.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf remote.git you teammate
git init -q --bare remote.git
git clone -q remote.git you
git clone -q remote.git teammate
git -C you config user.email "you@example.com"
git -C you config user.name "You"
git -C teammate config user.email "pat@example.com"
git -C teammate config user.name "Pat"

cd you
echo "base" > app.txt && git add app.txt && git commit -qm "base"
git push -q -u origin main
git checkout -qb feature
echo "you" > you.txt && git add you.txt && git commit -qm "you: wip"
git push -q -u origin feature
cd ../teammate
git fetch -q origin
git checkout -qb feature --track origin/feature
echo "pat" > pat.txt && git add pat.txt && git commit -qm "pat: important"
git push -q
cd ../you
echo "you more" >> you.txt && git commit -qam "you: more"
echo "now: git push --force origin feature   (drops pat's commit from origin)"
```

## Expected Failure

```bash
bash setup.sh
cd you
git push --force origin feature
git fetch origin
git log --oneline origin/feature
# you: more
# you: wip
# base
#  <- "pat: important" is not on origin
```

Pat still has it locally. Origin does not. Anyone who pulled after the force-push
lost the ref.

## Expected Outcome

Pat's commit is back on `origin/feature`, and future rewrites use lease.

```bash
git fetch origin
git log --oneline origin/feature
# includes "pat: important"
```

A force-with-lease after Pat pushed would have failed:

```bash
git push --force-with-lease origin feature
# rejected: stale info
```

## Hints

### Hint 1 — Recover from any clone that still has the SHA

`git fetch teammate-path feature` or ask Pat for the SHA (`git log -1`).
`git cherry-pick <sha>` or `git merge` that commit onto the rewritten branch.
GitHub's commit URL still works if you know the SHA (`/commit/<sha>`).

### Hint 2 — Lease compares to your remote-tracking ref

`--force-with-lease` succeeds only if `origin/feature` is still what you last
fetched. `git fetch` then `--force-with-lease` without looking is as dangerous as
`--force`. Fetch, `git log origin/feature`, then lease-push.

## Solution

Recover Pat's SHA and put it on the branch; stop using bare `--force`.

```bash
# from teammate clone:
git -C teammate log -1 --format=%H feature

# on your clone:
git fetch ../teammate feature:refs/remotes/pat/feature
git cherry-pick <pat-sha>
git push origin feature          # fast-forward, no force needed
```

Ongoing:

```bash
git config --global alias.pushf 'push --force-with-lease'
# never alias force without lease
```

- **`--force` is how shared branches lose commits.** Treat it as destroying the
  remote tip.
- **`--force-with-lease` is the default rewrite tool** for personal branches. It
  still rewrites; it just refuses to clobber unseen work.
- **Recover by SHA**, not by looking at the rewritten log. GitHub events, reflog on
  the server (if any), and other clones are the sources.
- **Protect `main` with a server rule** (`deny non-fast-forward`). Feature branches
  used by two people should be merged, not rebased, unless everyone agrees.
