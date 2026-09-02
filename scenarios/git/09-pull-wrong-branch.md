# pull said already up to date, but the remote has new commits

## Briefing

A teammate pushed `feature/api` an hour ago. You run `git pull` and git says
`Already up to date.` `git log` still lacks their commits. `git pull origin main`
is something you typed out of habit — and `main` really is up to date. The branch
you care about was never fetched, or you are not tracking it.

`git pull` fetches and merges the **upstream of the current branch**. It does not
mean "download everything from the remote". New remote branches, and updates to
branches you are not on, are invisible until you fetch them and check them out.

## Your Task

- Reproduce "Already up to date" while the remote branch has commits you do not have.
- Fetch the missing branch and set tracking correctly.
- Pull thereafter so it actually updates the branch you are on.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf remote.git alice bob
git init -q --bare remote.git
git clone -q remote.git alice && git clone -q remote.git bob

git -C alice config user.email "alice@example.com"
git -C alice config user.name "Alice"
git -C bob   config user.email "bob@example.com"
git -C bob   config user.name "Bob"

cd alice
echo "v1" > app.txt && git add app.txt && git commit -qm "initial"
git push -q -u origin main
git checkout -qb feature/api
echo "api" >> app.txt && git commit -qam "alice: api"
git push -q -u origin feature/api
cd ..

# bob is still on main, never fetched feature/api
cd bob
git pull -q origin main
echo "bob is on $(git branch --show-current); remote feature/api exists but bob has not fetched it"
```

## Expected Failure

```bash
bash setup.sh
cd bob
git pull
# Already up to date.

git branch -a
# * main
#   remotes/origin/main          <- no origin/feature/api yet if fetch refspec is default
#                                  (after a fetch it appears but you are still on main)

git log --oneline
# <sha> initial                  <- alice's "api" commit is not here
```

`git pull` updated `main`. Alice's work is on `feature/api`. Bob never asked for that
branch.

## Expected Outcome

Bob has the remote branch locally and is tracking it.

```bash
git fetch origin
git branch -r | grep feature/api
# origin/feature/api

git switch -c feature/api --track origin/feature/api
git log --oneline
# <sha> alice: api
# <sha> initial
```

A later `git pull` on that branch brings new commits:

```bash
git status -sb
# ## feature/api...origin/feature/api
```

## Hints

### Hint 1 — pull = fetch + merge of upstream

`git status -sb` shows `## branch...origin/branch` when tracking is set. No
`...origin/...` means `git pull` has nothing to merge except what you pass
explicitly (`git pull origin some-branch`). `git fetch --all --prune` then
`git branch -r` is how you *see* new remote branches.

### Hint 2 — switch --track

`git switch feature/api` (modern git) creates a local branch tracking
`origin/feature/api` if that remote-tracking branch exists. If fetch never ran,
the remote-tracking ref does not exist yet — fetch first.

## Solution

Fetch, then check out the branch you actually want, with tracking.

```bash
git fetch origin
git branch -r
git switch --track origin/feature/api
# older git: git checkout -b feature/api origin/feature/api

git status -sb
# ## feature/api...origin/feature/api
```

- **`git pull` is not "sync the universe".** It updates the current branch's
  upstream. Habit: `git fetch --all --prune` then look at `git branch -r` / `git log
  --all --oneline --graph`.
- **`git pull origin main` while on `feature` merges `main` into `feature`** — a
  different surprise. Say the branch names you mean.
- **`--prune` deletes stale `origin/old-feature` refs** so you do not keep working
  on a branch that was deleted upstream.
- **`git remote show origin`** lists tracked branches and "new (next fetch will
  store in remotes/origin)" — a good "what am I missing?" command.
