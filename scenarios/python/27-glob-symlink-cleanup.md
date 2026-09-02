# The cleanup glob followed a symlink and wiped /var/lib/app

## Briefing

`cleanup.py` deletes `Path(root).glob("**/*.tmp")` under `/var/tmp/scratch`
after a CI job. A job created `/var/tmp/scratch/data` as a **symlink into
`/var/lib/app`**. `Path.glob` / `rglob` follows it (or `unlink` on a
symlink vs the target — depending on how you coded the delete). Operators
meant to clear scratch. They cleared the application state directory.

Bash-01 is unquoted `"$dir"`. This is **Python pathlib + symlink + glob**.
The rule is the same: the script must not be more recursive than the
operator thought, and it must not follow links out of the root.

## Your Task

- Build a scratch dir with a symlink pointing outside, run the cleanup,
  and show files outside the root getting deleted (or show the unsafe
  pattern).
- Refuse to follow symlinks (`follow_symlinks=False`, `os.lstat`, skip
  dirs where `path.is_symlink()`).
- Bound the glob to a resolved root that is still under the intended
  prefix.

## Starter Files

### file: cleanup.py

```python
#!/usr/bin/env python3
import sys
from pathlib import Path

ROOT = Path("scratch")


def main():
    n = 0
    for p in ROOT.glob("**/*"):
        if p.is_dir():
            continue
        p.unlink()
        n += 1
        print("deleted", p)
    print("removed %d files" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf scratch outside
mkdir -p scratch/ok outside
echo keep-me > outside/state.txt
echo tmp > scratch/ok/foo.tmp
ln -s "$(pwd)/outside" scratch/data
echo "scratch/data -> outside (the production-shaped mistake)"
```

## Expected Failure

```bash
bash setup.sh
python3 cleanup.py
# deleted scratch/ok/foo.tmp
# deleted scratch/data/state.txt     # that was outside/state.txt
cat outside/state.txt
# No such file or directory
```

`glob("**/*")` descended through the symlink. The "scratch" cleanup
touched the real state dir.

## Expected Outcome

```bash
bash setup.sh
python3 cleanup.py
# deleted scratch/ok/foo.tmp
# skip symlink scratch/data
cat outside/state.txt
# keep-me
```

Only files whose **resolved** path stays under `scratch.resolve()` are
removed, and symlink dirs are not descended.

## Hints

### Hint 1 — is_symlink before you descend

`p.is_symlink()` on the directory. Skip. `unlink` on a symlink removes
the link, not the target — but globbing *through* the link unlinks
targets.

### Hint 2 — Resolve and prefix-check

`real = p.resolve()` and `root = ROOT.resolve()`; skip unless
`root in real.parents or real == root`. Watch out for `resolve()` itself
following the link — use `os.path.realpath` carefully and compare.

## Solution

```python
root = ROOT.resolve()
for p in ROOT.rglob("*"):
    if p.is_symlink() or any(parent.is_symlink() for parent in p.parents if root in parent.parents or parent == ROOT):
        print("skip symlink", p)
        continue
    if p.is_file():
        p.unlink()
```

A smaller hammer: `glob("*/*.tmp")` without `**`, no recursion.

- **`**` plus a symlink is another filesystem.**
- **CI scratch that bind-mounts the workspace** is this bug in Docker.
- **`shutil.rmtree` follows the same rules** — use
  `onerror` / `ignore` and do not `follow_symlinks`.
- **Print every path you will delete** in a dry-run flag before you
  enable the cron (argparse default: dry-run, drill 08).
