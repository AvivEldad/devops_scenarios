# The .gitignore that ignores nothing

## Briefing

You inherit a small automation repository. On your first day you notice
`config/secrets.env` sitting in the working tree with a live-looking API token in it.

You do the obvious thing: add it to `.gitignore`. Git carries on reporting it as
modified, and the token is still visible to anyone who clones the repo.

## Your Task

Run the setup script to create the broken repository, then:

1. Make git stop tracking `config/secrets.env` while keeping the file on your disk —
   the application needs it locally.
2. Remove the secret from the repository history so a fresh clone does not contain it.
3. Leave a committed example file so the next person knows which variables are needed.

Treat the token as genuinely leaked: assume it must be rotated. Removing it from git
is damage control, not a fix.

```bash
mkdir -p ~/breakfix/git-01 && cd ~/breakfix/git-01
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Creates the broken repository. Run once: bash setup.sh
set -euo pipefail

rm -rf leaky-repo
mkdir leaky-repo
cd leaky-repo

git init -q -b main
git config user.email "you@example.com"
git config user.name "You"

mkdir -p config src

cat > src/deploy.py <<'EOF'
import os

TOKEN = os.environ["DEPLOY_TOKEN"]

def main():
    print("deploying with token ending %s" % TOKEN[-4:])

if __name__ == "__main__":
    main()
EOF

cat > config/secrets.env <<'EOF'
DEPLOY_TOKEN=ghp_R3alL00k1ngT0k3nDoNotUse00000000
DB_PASSWORD=sup3rs3cret
EOF

cat > README.md <<'EOF'
# deploy-tools

Run: python3 src/deploy.py
EOF

git add -A
git commit -q -m "initial import of deploy tooling"

echo "build/" > .gitignore
git add .gitignore
git commit -q -m "add gitignore"

echo "DB_PASSWORD=sup3rs3cret-rotated" >> config/secrets.env
git add config/secrets.env
git commit -q -m "update db password"

echo "Repository created at $(pwd)"
git log --oneline
```

## Expected Failure

Set it up and try the intuitive fix:

```bash
bash setup.sh
cd leaky-repo
echo "config/secrets.env" >> .gitignore
git status
```

Git ignores your `.gitignore`:

```
Changes not staged for commit:
        modified:   config/secrets.env
```

And the secret is in history regardless of what the working tree looks like:

```bash
git log --oneline -- config/secrets.env
git show HEAD:config/secrets.env
# DEPLOY_TOKEN=ghp_R3alL00k1ngT0k3nDoNotUse00000000
```

Deleting the file and committing would not help either — the old commits still
contain it, and `git log -p` would happily print the token to anyone who asks.

## Expected Outcome

Four things must be true.

The file still exists on disk, because your local runs need it:

```bash
ls -l config/secrets.env
# -rw------- 1 you you ... config/secrets.env
```

Git no longer tracks it and no longer reports it:

```bash
git ls-files config/secrets.env
# (no output)

git status --short
# clean, or showing only intended changes
```

No commit in history contains the token:

```bash
git log --all --oneline -S 'ghp_R3alL00k1ngT0k3n'
# (no output)

git grep -I 'ghp_R3alL00k1ngT0k3n' $(git rev-list --all)
# (no output; exits non-zero, which is what you want here)
```

A committed template documents the required variables without the values:

```bash
git ls-files config/
# config/secrets.env.example

cat config/secrets.env.example
# DEPLOY_TOKEN=
# DB_PASSWORD=
```

## Hints

### Hint 1 — .gitignore only applies to untracked files

This is the single most misunderstood thing about `.gitignore`. It controls which
**untracked** files git suggests adding. Once a file is in the index, git tracks it
forever and the ignore rule is irrelevant.

Confirm the file is tracked:

```bash
git ls-files config/secrets.env
```

You need to remove it from the index without deleting it from your disk. Look up
what `--cached` does for `git rm`.

### Hint 2 — Untracking is not un-leaking

After `git rm --cached` and a commit, the file disappears from future commits and
`git status` goes quiet. But run this and the token is still there:

```bash
git show HEAD~1:config/secrets.env
```

Every previous commit is immutable and still contains the value. To remove it from
history you must rewrite those commits, which changes their hashes.

### Hint 3 — Choosing a history-rewriting tool

Two realistic options:

- `git filter-repo` (recommended, and what the git project itself points you to).
  Install with `pip install git-filter-repo`.
- `git filter-branch` — built in, but slow and full of sharp edges; git prints a
  warning telling you not to use it.

With `filter-repo`, `--invert-paths --path <file>` removes a path from all history.
On a fresh single-branch repo like this, you can also rebuild history, but practise
the tool you would actually reach for at work.

### Hint 4 — Think about the blast radius before you rewrite

Rewriting history changes every commit hash from the touched commit onward. On a
shared branch that forces everyone else to re-clone or reset, and any open pull
request will conflict. In a real incident the sequence is: rotate the credential
first, then clean history, then tell the team what to do with their clones.

## Solution

Three separate actions, in a specific order.

**Step 1 — rotate the credential.** Not a git command. The token was pushed and must
be assumed compromised; anything else you do is cleanup, not remediation. In this
exercise, note it as the first line of your write-up.

**Step 2 — stop tracking the file, keep it on disk.**

```bash
cd leaky-repo

# ensure the ignore rule exists first
grep -q '^config/secrets.env$' .gitignore || echo 'config/secrets.env' >> .gitignore

# remove from the index only
git rm --cached config/secrets.env

# commit a template so the required keys are documented
sed 's/=.*/=/' config/secrets.env > config/secrets.env.example
git add .gitignore config/secrets.env.example
git commit -m "stop tracking secrets.env; add example template"

chmod 600 config/secrets.env
```

**Step 3 — purge it from history.**

```bash
pip install git-filter-repo    # once

git filter-repo --invert-paths --path config/secrets.env --force
```

Verify nothing remains:

```bash
git log --all --oneline -S 'ghp_R3alL00k1ngT0k3n'   # no output
git ls-files config/                                 # only the .example file
ls config/secrets.env                                # still on disk
```

If `git filter-repo` is unavailable, the built-in equivalent is:

```bash
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch config/secrets.env' \
  --prune-empty --tag-name-filter cat -- --all
```

After a rewrite on a real shared repository you must also:

```bash
git push --force-with-lease --all
git push --force-with-lease --tags
```

and tell every collaborator to re-clone. Use `--force-with-lease` rather than
`--force`: it refuses the push if someone else has updated the remote since you last
fetched, which turns a silent overwrite of a colleague's work into an error message.

Note that on hosted platforms the old commits can remain reachable through pull
request refs and caches until you ask support to purge them. This is the real reason
rotation comes first.

## What You Learned

`.gitignore` prevents accidents; it does not undo them. Tracked is tracked.

The wider lesson is the order of operations during a credential leak, which is worth
memorising because you will do it under pressure: rotate, then untrack, then rewrite,
then notify. People routinely start with the rewrite because it feels like the
technical fix, and spend an hour cleaning history while the live token is still
valid.
