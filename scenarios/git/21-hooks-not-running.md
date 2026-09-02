# The pre-commit hook never runs

## Briefing

The repo has `.git/hooks/pre-commit` (or a `pre-commit` framework config) that should
block secrets and format Python. People commit unformatted files and secrets anyway.
The hook file is not executable, or it lives in the repo as `hooks/pre-commit` but
git only runs **`.git/hooks/`**, or `git commit --no-verify` is in someone's alias,
or core.hooksPath points somewhere empty.

Client hooks are optional and local. They are not a security boundary — they are a
courtesy that fails closed only when installed correctly.

## Your Task

- Put a hook in the wrong place or without `+x` and commit something it should block.
- Make the hook actually run for this clone.
- Know what `--no-verify` and missing `hooksPath` do.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
echo "ok" > app.py && git add app.py && git commit -qm "base"
mkdir -p hooks
cat > hooks/pre-commit <<'EOF'
#!/usr/bin/env bash
echo "hook would block this commit" >&2
exit 1
EOF
# NOT executable, and NOT in .git/hooks
chmod 644 hooks/pre-commit
echo "secret" > leak.txt
git add leak.txt
echo "now: git commit -m 'add leak'  — hook does not run"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git commit -m "add leak"
# [main xxxx] add leak          <- succeeded; hook never ran

ls -l .git/hooks/pre-commit
# sample file, or missing
```

The team's hook is in `hooks/pre-commit` in the working tree — git ignores it. Even
copied to `.git/hooks/pre-commit`, without `+x` the kernel will not execute it and
git may skip it silently.

## Expected Outcome

A commit that should be blocked fails with the hook's message.

```bash
chmod +x .git/hooks/pre-commit
git commit -m "add leak"
# hook would block this commit
# (commit aborted)
```

`git commit --no-verify` still bypasses it (document that this is not security).

## Hints

### Hint 1 — Only .git/hooks (or core.hooksPath) run

Tracked files under `hooks/` in the project are just files. Install with
`cp hooks/pre-commit .git/hooks/ && chmod +x` or `git config core.hooksPath
./hooks` **and** `chmod +x hooks/*`. `core.hooksPath` is how a repo can share hooks
without copying, if everyone sets it (or a bootstrap script does).

### Hint 2 — Executable bit and shebang

`bash .git/hooks/pre-commit` working does not mean git will run it — git execs the
file. `chmod +x` and a valid shebang (`#!/usr/bin/env bash`) are required. CRLF in
the shebang causes `bad interpreter` and the hook fails open or closed depending on
git version — keep hooks LF.

## Solution

Install the hook where git looks, make it executable, and optionally set hooksPath.

```bash
cp hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
# or:
git config core.hooksPath hooks
chmod +x hooks/pre-commit

echo "secret" > leak.txt
git add leak.txt
git commit -m "add leak"     # blocked
```

- **Client hooks are not enforcement.** `--no-verify`, a missing `+x`, and a clone
  without `hooksPath` all skip them. Use server-side pre-receive / CI for real
  gates.
- **`.git/hooks` is not cloned.** Every developer and every CI image needs install.
  Document a `make hooks` / `pre-commit install` step.
- **`core.hooksPath`** is the modern way to keep hooks in-tree; it is still a local
  config unless you wrap `git clone`.
- **Husky / pre-commit.com** fail the same ways: not installed in CI, or
  `SKIP=hook` in the environment. Check the install ran.
