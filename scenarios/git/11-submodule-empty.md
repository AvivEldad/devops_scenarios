# The submodule directory is empty after clone

## Briefing

You cloned the application repo. `vendor/lib` (or `charts/shared`) exists as a
directory but has no files. The build fails looking for sources that "are definitely
in the repo". They are not — they live in a **submodule**, and a normal `git clone`
does not populate submodule working trees.

The parent repo only stores a gitlink (a commit SHA of another repository). Without
`clone --recurse-submodules` or `submodule update --init`, you get an empty folder.

## Your Task

- Clone a parent repo that records a submodule and observe the empty directory.
- Initialize and update the submodule so the files appear.
- Pin the intended SHA (not "whatever latest on the submodule's main is").

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lib.git app.git app
git init -q --bare lib.git
git init -q --bare app.git

git clone -q lib.git lib-w
git -C lib-w config user.email "you@example.com"
git -C lib-w config user.name "You"
echo "helper" > lib-w/helper.py
git -C lib-w add helper.py && git -C lib-w commit -qm "lib v1"
git -C lib-w push -q origin HEAD:main

git clone -q app.git app-w
git -C app-w config user.email "you@example.com"
git -C app-w config user.name "You"
echo "app" > app-w/app.py
git -C app-w add app.py && git -C app-w commit -qm "app"
git -C app-w submodule add ../lib.git vendor/lib
git -C app-w commit -qm "add lib submodule"
git -C app-w push -q origin HEAD:main

git clone -q app.git app
echo "cloned app WITHOUT --recurse-submodules; ls app/vendor/lib"
```

## Expected Failure

```bash
bash setup.sh
ls app/vendor/lib
# (empty — or the directory does not even list helper.py)

ls -la app/vendor/lib
# drwxr-xr-x  .git   (or no files)

cat app/.gitmodules
# [submodule "vendor/lib"]
#     path = vendor/lib
#     url = ../lib.git
```

The parent knows *which commit* of `lib` to use; nobody checked that commit out.

## Expected Outcome

`vendor/lib` contains the library files at the recorded SHA.

```bash
git -C app submodule update --init --recursive
ls app/vendor/lib
# helper.py

git -C app/vendor/lib log -1 --oneline
# matches the gitlink stored in the parent
```

A fresh clone can do it in one step:

```bash
git clone --recurse-submodules app.git app2
```

## Hints

### Hint 1 — gitlink vs files

`git ls-tree HEAD vendor` in the parent shows `160000 commit <sha>` — a submodule
pointer, not a directory of files. `cat .gitmodules` lists path and URL. Empty folder
= pointer present, checkout missing.

### Hint 2 — Init then update

`git submodule init` copies `.gitmodules` URLs into `.git/config`.
`git submodule update` clones and checks out the recorded SHA. Combined:
`git submodule update --init --recursive`. `--remote` is a different animal: it
moves the submodule to the latest of its tracking branch (usually *not* what you
want in a prod pin).

## Solution

Initialize the submodule at the SHA the parent recorded.

```bash
cd app
git submodule update --init --recursive
ls vendor/lib
```

For CI / docs, clone with recursion:

```bash
git clone --recurse-submodules <url>
# already cloned:
git submodule update --init --recursive
```

- **A submodule is a pinned commit of another repo**, not "a folder git copies". The
  parent commit is what pins the SHA; updating the lib means a new parent commit.
- **Forgetting `--recurse-submodules` is the standard clone footgun.** Put it in the
  README and in CI checkout (`submodules: true` / `git submodule update --init`).
- **`--remote` / `submodule update --remote` floats to latest** — useful for
  deliberately bumping, disastrous as a silent default in production builds.
- **Nested submodules need `--recursive`.** One `--init` is not enough for a tree.
