# CI cloned --depth 1 and cannot describe or push tags

## Briefing

The release job runs `git describe --tags` or `git push origin v1.2.3` and fails:
`fatal: No names found, cannot describe anything.` or `shallow update not allowed`.
The checkout action used `fetch-depth: 1`. A shallow clone has the tip commit and
not the tag history (or not enough ancestry) for describe, blame, or merging.

Shallow clones are a performance feature. Jobs that need history must unshallow or
fetch tags explicitly.

## Your Task

- Create a repo with tags and a `--depth 1` clone.
- Reproduce `git describe` failure and a rejected operation that needs history.
- Unshallow / fetch tags so describe and the release push work.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf remote.git shallow full
git init -q --bare remote.git
git clone -q remote.git full
git -C full config user.email "you@example.com"
git -C full config user.name "You"
cd full
echo "v1" > app.txt && git add app.txt && git commit -qm "one"
git tag -a v1.0.0 -m "1.0.0"
echo "v2" >> app.txt && git commit -qam "two"
git tag -a v1.1.0 -m "1.1.0"
echo "v3" >> app.txt && git commit -qam "three"
git push -q --tags origin HEAD:main
cd ..
git clone --depth 1 file://$PWD/remote.git shallow
echo "shallow clone done; git -C shallow describe --tags"
```

## Expected Failure

```bash
bash setup.sh
git -C shallow describe --tags
# fatal: No names found, cannot describe anything.

git -C shallow log --oneline | wc -l
# 1

git -C shallow fetch origin v1.1.0
# may still not have ancestry for describe --dirty workflows
```

`git merge-base` with `main` on a full clone can also fail from CI if the job
needs more than one commit.

## Expected Outcome

Describe prints a tag (or tag-N-gSHA) and the job can create/push a new tag if
required.

```bash
git -C shallow fetch --unshallow --tags
git -C shallow describe --tags
# v1.1.0   (or v1.1.0-1-gXXXX if HEAD is after the tag)
```

In GitHub Actions, `fetch-depth: 0` (full) or `fetch-tags: true` with enough
depth.

## Hints

### Hint 1 — depth 1 is only HEAD

`git rev-list --count HEAD` is 1. Tags not pointing at HEAD are not fetched by
default in a shallow clone. `git describe` needs a reachable annotated tag.

### Hint 2 — unshallow vs fetch-depth: 0

`git fetch --unshallow` converts the clone to a full one (costly but complete).
`git fetch --tags --depth=100` is a middle ground. `actions/checkout` with
`fetch-depth: 0` is the usual release-job fix. `persist-credentials` and tag
push permissions are a separate issue (`contents: write`).

## Solution

Fetch the missing history and tags, then describe.

```bash
cd shallow
git fetch --unshallow origin
git fetch --tags origin
git describe --tags --abbrev=0
```

Actions:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
    fetch-tags: true
```

- **Shallow clones break** `describe`, `blame` across old files, `merge-base`
  with far SHAs, and some `git log` ranges. Fast CI jobs should stay shallow;
  release/changelog jobs should not.
- **`--unshallow` is a full fetch** — do it only when needed, not on every lint
  job.
- **Lightweight vs annotated tags:** `describe` prefers annotated (`-a`/`-s`).
  Lightweight tags may be ignored depending on flags.
- **`safe.directory` and detached HEAD** in CI also confuse describe; check
  `git status` in the job log.
