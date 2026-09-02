# The symlink that points at nothing

## Briefing

A config or binary is reached through a symbolic link, and everything breaks with
`No such file or directory` — even though both the link and the real file exist. Or a link
that worked in one directory is broken after you moved or copied it.

Symlinks store a *path*, not a reference to the file. A relative symlink is resolved from
the link's own location; an absolute one breaks if the target moves. Copying with the wrong
flags can turn a link into a broken copy or dereference it unexpectedly.

## Your Task

- Create a symlink that resolves, then break it the two common ways.
- Diagnose why the link does not resolve using the link's stored target.
- Repair it so the link points at the real file, robustly.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir -p lab/releases/v2 lab/current-config
echo "real config v2" > lab/releases/v2/app.conf

cd lab
# a RELATIVE symlink created from the wrong working directory -> stores a wrong path
ln -s releases/v2/app.conf current-config/app.conf   # relative to cwd, not to the link dir
# an ABSOLUTE symlink to a path that will move
ln -s "$PWD/releases/v2/app.conf" active.conf
echo "created links:"
ls -l current-config/app.conf active.conf
```

## Expected Failure

```bash
bash setup.sh
cd lab
cat current-config/app.conf
# cat: current-config/app.conf: No such file or directory

# the link exists but points to a path that does not resolve from the link's location:
ls -l current-config/app.conf
# app.conf -> releases/v2/app.conf
readlink current-config/app.conf
# releases/v2/app.conf        <- resolved RELATIVE TO current-config/, i.e. current-config/releases/v2/...
```

```bash
readlink -f current-config/app.conf
# (empty / nonexistent path) -> broken link
```

The relative link stores `releases/v2/app.conf`, which is resolved *relative to the link's
own directory* (`current-config/`), pointing at
`current-config/releases/v2/app.conf` — which does not exist. The absolute link works until
its target path moves.

## Expected Outcome

Both links resolve to the real file.

`readlink -f` resolves to an existing path:

```bash
readlink -f current-config/app.conf
# /path/lab/releases/v2/app.conf   (exists)

cat current-config/app.conf
# real config v2
```

A relative link is correct *from the link's location*, so it survives the whole tree being
moved:

```bash
ls -l current-config/app.conf
# app.conf -> ../releases/v2/app.conf
```

## Hints

### Hint 1 — A symlink stores a path, resolved from its own directory

`readlink <link>` shows the stored target verbatim; `readlink -f <link>` shows the fully
resolved absolute path (empty/failing if broken). A relative target is interpreted relative
to the directory the link lives in, NOT your current working directory when you `cat` it —
that is the classic mistake at creation time.

### Hint 2 — Relative for portable trees, absolute for fixed locations

A relative symlink (`../releases/v2/app.conf`) keeps working if you move the whole tree,
which is what you want for release layouts. An absolute symlink breaks if the target moves
but is unambiguous from anywhere. Use `ln -sfn` to atomically repoint an existing link
(common for a `current -> releases/vN` switch). `cp -P`/`-a` preserves links; `cp -L`
follows them.

## Solution

The relative link stored a path wrong for its location; recreate it relative to the link's
own directory (or use an absolute target).

```bash
cd lab

# fix the relative link: target is relative to current-config/
ln -sfn ../releases/v2/app.conf current-config/app.conf
readlink -f current-config/app.conf     # resolves
cat current-config/app.conf             # real config v2

# the atomic 'current release' pattern:
ln -sfn releases/v2 current              # repoint 'current' to v2 in one step
```

- **A symlink is a stored path, not a file reference.** It breaks whenever that path stops
  resolving — target moved/renamed/deleted, or the link itself moved to a directory where
  the relative path no longer makes sense.
- **Relative targets resolve from the link's directory**, not your shell's cwd. Create them
  from that directory (or reason carefully about the `../` prefix), not from wherever you
  happen to be standing.
- **`readlink` shows the stored target; `readlink -f` resolves it.** An empty/failing
  `readlink -f` means the link is dangling — the fastest way to confirm a broken symlink.
- **Choose relative vs absolute deliberately.** Relative survives moving the whole tree
  (great for release directories); absolute is unambiguous but breaks if the target
  relocates.
- **`ln -sfn` repoints atomically** — the basis of zero-downtime "flip `current` to the new
  release" deploys. `cp -P`/`-a` preserve symlinks; `cp -L` dereferences them (which can
  silently duplicate large files).
