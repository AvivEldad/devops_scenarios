# Every file is modified and I did not change anything

## Briefing

You clone a repository on Linux (or macOS) and `git status` shows dozens of files
modified. `git diff` is a wall of `^M` (CRLF) or every file as mode `100755` vs
`100644`. You did not touch them. Committing would be a one-line whitespace or
filemode bomb on every future blame.

Git is comparing what is in the index to what the working tree looks like *after*
your OS and `core.autocrlf` / `core.filemode` settings. The files on disk are "the
same" as far as you are concerned; git disagrees about line endings or the
executable bit.

## Your Task

- Reproduce a dirty tree caused by line endings or filemode, not by real edits.
- Identify which setting is lying.
- Make `git status` clean without committing noise, and prevent it for the next clone.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
# repo stored with LF, no .gitattributes
printf 'hello\nworld\n' > app.sh
git add app.sh && git commit -qm "lf file"
# now simulate a Windows-ish checkout converting to CRLF in the worktree
git config core.autocrlf true
rm app.sh
git checkout -- app.sh
echo "status will likely show app.sh modified (CRLF vs LF), or filemode if you chmod +x"
chmod +x app.sh 2>/dev/null || true
```

## Expected Failure

```bash
bash setup.sh
cd lab
git status
# modified: app.sh

git diff
# ^M at end of lines
# and/or
# old mode 100644
# new mode 100755
```

You have not changed the program. Git is reporting conversion or permission bits.
Committing this pollutes history and fights the next person on the other OS.

## Expected Outcome

`git status` is clean, and the repo records the intended endings/mode once.

```bash
git status
# nothing to commit, working tree clean
```

A `.gitattributes` pins endings for scripts:

```bash
cat .gitattributes
# * text=auto
# *.sh text eol=lf
```

Filemode noise is off if you do not need executable bits on this clone:

```bash
git config core.filemode false    # only if the repo should not track +x here
```

## Hints

### Hint 1 — Ask git why, not just what

`git diff` with `core.autocrlf` shows `^M`. `git diff --summary` shows mode changes.
`git config --show-origin core.autocrlf core.filemode` tells you which config is
active. `file app.sh` reports `CRLF` vs `LF`.

### Hint 2 — Fix in attributes, not with a giant commit

`.gitattributes` with `*.sh text eol=lf` is the repo-wide contract. Then
`git add --renormalize .` once, in a dedicated commit, if history was mixed. Do not
leave `core.autocrlf=true` on a Unix machine "to match Windows" — that is how this
starts.

## Solution

Identify CRLF vs filemode, then pin the repo and reset the worktree.

```bash
git diff --summary
git config --show-origin core.autocrlf
git config --show-origin core.filemode

# line endings: pin in the repo
printf '%s\n' '* text=auto' '*.sh text eol=lf' > .gitattributes
git add .gitattributes
git add --renormalize .
git commit -m "pin LF for shell scripts"

# filemode noise on a filesystem that does not care about +x:
git config core.filemode false
git checkout -- .

git status          # clean
```

- **`core.autocrlf` converts on checkout/commit.** On Windows `true` is common; on
  Unix it should almost always be `input` or `false`, with `.gitattributes` as the
  source of truth.
- **`core.filemode`:** git tracks the executable bit. On Windows/WSL/shared mounts
  this bit can flip for every file. Disable filemode locally only when `+x` is not
  meaningful; otherwise `chmod` the real scripts and commit that once.
- **Never "fix" this by committing every file as CRLF** on a Unix clone. You will
  fight the next Linux CI runner.
- **`.gitattributes` survives machines.** Personal `core.*` settings do not. Put the
  contract in the repo.
