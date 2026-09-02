# A hard reset ate this morning's work

## Briefing

A teammate was trying to undo one bad commit. They ran `git reset --hard` with the
wrong reference, then `git commit` on top, and now four hours of work from three
commits is simply not there.

`git log` shows none of it. `git branch -a` shows nothing unusual. The files are gone
from the working tree. They are convinced the work is lost and have started rewriting
it from memory.

It is almost certainly still in the repository. Git does not delete unreachable
commits immediately, and it keeps a local journal of everywhere `HEAD` has ever been.

## Your Task

Run the setup script, which reproduces the accident exactly. Then, without rewriting
the work by hand:

1. Find the three lost commits.
2. Restore them onto a branch so the work is reachable again.
3. Additionally recover one file that was staged but never committed.
4. Explain how long you had before this became genuinely unrecoverable.

```bash
mkdir -p ~/breakfix/git-03 && cd ~/breakfix/git-03
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Reproduces the accident: three commits destroyed by a bad hard reset.
set -euo pipefail

rm -rf lost-work
mkdir lost-work
cd lost-work

git init -q -b main
git config user.email "you@example.com"
git config user.name "You"

mkdir -p terraform scripts

cat > README.md <<'EOF'
# platform-tools
EOF
git add -A
git commit -q -m "initial commit"

cat > scripts/deploy.sh <<'EOF'
#!/usr/bin/env bash
echo "deploying"
EOF
git add -A
git commit -q -m "add deploy script"

# ----- the morning's work: three commits that will be destroyed -----
cat > terraform/vpc.tf <<'EOF'
resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true

  tags = { Name = "platform-vpc" }
}
EOF
git add -A
git commit -q -m "add vpc module"

cat > terraform/subnets.tf <<'EOF'
resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 4, count.index)
  availability_zone = element(var.azs, count.index)

  tags = { Name = "private-${count.index}" }
}
EOF
git add -A
git commit -q -m "add private subnets across three azs"

cat > scripts/plan.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd terraform
terraform init -input=false
terraform plan -out=tfplan
EOF
chmod +x scripts/plan.sh
git add -A
git commit -q -m "add terraform plan wrapper"

# a file staged but never committed
cat > terraform/outputs.tf <<'EOF'
output "vpc_id" {
  value = aws_vpc.main.id
}
EOF
git add terraform/outputs.tf

# ----- the accident -----
git reset --hard HEAD~3 >/dev/null

cat > scripts/rollback.sh <<'EOF'
#!/usr/bin/env bash
echo "rolling back"
EOF
git add -A
git commit -q -m "add rollback script"

echo "Repository created at $(pwd)"
echo
echo "This is what the victim sees:"
git --no-pager log --oneline
ls terraform/ 2>/dev/null || echo "terraform/ is empty"
```

## Expected Failure

```bash
bash setup.sh
cd lost-work
git log --oneline
```

```
b7e2a91 add rollback script
4c1d8f3 add deploy script
9a0f5e2 initial commit
```

The three commits from this morning are absent. So are the files:

```bash
ls terraform/
# empty

git branch -a
# * main          -- nothing else, no stash, no tag
```

Searching the branches finds nothing, because nothing points at those commits any
more. In git terms they are *unreachable*, which is not the same as deleted.

## Expected Outcome

All three commits are back, on a branch, with their original messages and content.

A branch named `recovered` contains the lost work:

```bash
git log --oneline recovered -n 4
# <sha> add terraform plan wrapper
# <sha> add private subnets across three azs
# <sha> add vpc module
# <sha> add deploy script
```

The files are present with their original contents:

```bash
git show recovered:terraform/vpc.tf | grep 10.20.0.0/16
git show recovered:terraform/subnets.tf | grep 'count             = 3'
git show recovered:scripts/plan.sh | grep 'terraform plan'
```

The staged-but-never-committed file is also recovered:

```bash
git show <dangling-blob-sha> | grep 'output "vpc_id"'
# output "vpc_id" {
```

The commit that was made after the accident is still intact — you must not have
destroyed it while recovering:

```bash
git log --oneline main | grep 'add rollback script'
```

And a final integrated state exists where both the recovered work and the rollback
script are present together:

```bash
git log --oneline -n 6        # on whichever branch you integrate onto
ls terraform/ scripts/
# vpc.tf subnets.tf ... deploy.sh plan.sh rollback.sh
```

## Hints

### Hint 1 — HEAD keeps a diary

Every time `HEAD` moves — commit, checkout, reset, merge, rebase — git appends a line
to the reflog. It is local, it is not part of history, and it is not affected by
`reset`:

```bash
git reflog
```

Read it from the bottom up and you will see the whole accident, including the entry
immediately before the reset. That entry's SHA is the tip of the work you lost.

### Hint 2 — Name the commit before you do anything else

Unreachable commits are eligible for garbage collection. The moment you find the SHA,
give it a name so it becomes reachable again:

```bash
git branch recovered <sha>
```

Creating a branch is non-destructive and instantly removes the time pressure. Only
then start thinking about how to integrate.

### Hint 3 — The staged file is a dangling blob, not a commit

`terraform/outputs.tf` was added to the index but never committed, so it has no
commit to recover. `git add` does write the content into the object database as a
blob, though, and `fsck` can find orphaned objects:

```bash
git fsck --lost-found
git fsck --unreachable | grep blob
```

Inspect a candidate with `git show <sha>` or `git cat-file -p <sha>`.

### Hint 4 — Integrating without destroying the newer commit

You now have two lines of work: `main` with the rollback script, and `recovered` with
the morning's three commits. Both are wanted.

`git merge recovered` from `main` combines them and keeps everything. Avoid
`git reset --hard recovered` — you would be repeating the original mistake in the
opposite direction and losing the rollback commit.

### Hint 5 — How long did you have

`git gc` prunes unreachable objects, but not immediately. Check the defaults:

```bash
git config --get gc.reflogExpireUnreachable   # default 30 days
git config --get gc.pruneExpire               # default 2 weeks
```

Unreachable commits normally survive around 30 days via the reflog, and loose objects
are not pruned until they are at least two weeks old. An explicit
`git gc --prune=now` or `git reflog expire --expire-unreachable=now --all` collapses
that window to zero, which is why "run gc to clean up" is dangerous advice during a
recovery.

## Solution

The commits were never deleted; the branch pointer was moved so nothing referenced
them any more.

**Step 1 — find them in the reflog.**

```bash
cd lost-work
git reflog
```

```
b7e2a91 HEAD@{0}: commit: add rollback script
4c1d8f3 HEAD@{1}: reset: moving to HEAD~3
1f4c7d8 HEAD@{2}: commit: add terraform plan wrapper      <-- the lost tip
e93b2a5 HEAD@{3}: commit: add private subnets across three azs
7d5c0b1 HEAD@{4}: commit: add vpc module
```

`HEAD@{2}` is the tip of the work that was destroyed. Everything below it is
reachable from it.

**Step 2 — make it reachable immediately.**

```bash
git branch recovered HEAD@{2}
git log --oneline recovered -n 4
```

You can also use the SHA directly: `git branch recovered 1f4c7d8`. Reflog
expressions like `HEAD@{2}` are position-based and shift as you work, so once you
have the branch, prefer the SHA in any notes you write.

**Step 3 — recover the staged-only file.**

```bash
git fsck --lost-found
# dangling blob a1b2c3d...

git cat-file -p a1b2c3d
# output "vpc_id" {
#   value = aws_vpc.main.id
# }

git cat-file -p a1b2c3d > terraform/outputs.tf
```

**Step 4 — integrate both lines of work.**

```bash
git checkout main
git merge recovered -m "restore work lost to an accidental hard reset"
git add terraform/outputs.tf
git commit -m "add vpc outputs"

git log --oneline -n 6
ls terraform/ scripts/
```

Why the reflog saved you, in one sentence: branches are just movable pointers to
commits, `reset --hard` moves a pointer and updates your working tree but touches no
commit objects, and the reflog independently records every position that pointer has
held.

Three practices that prevent the next occurrence:

- Use `git reset --keep` or `git restore` when you want to undo local changes; both
  refuse to discard uncommitted work rather than silently destroying it.
- Prefer `git revert` on anything shared. It creates a new commit that undoes the
  change, so history stays append-only and nothing can be lost.
- Set `git config --global push.default simple` and always push with
  `--force-with-lease` rather than `--force`, so a force-push aborts if the remote
  moved since your last fetch.

## What You Learned

"The commits are gone" is nearly always false. Git is an append-only object store
with movable pointers, and losing a pointer is not losing the objects. Until garbage
collection actually runs, almost everything is recoverable — including work that was
only ever staged.

The instinct worth building is the first move under pressure: run `git reflog` before
you run anything else, and the moment you identify the lost SHA, create a branch. A
branch costs nothing, takes one second, and converts an emergency into an ordinary
merge.
