# Argument list too long

## Briefing

A routine command over many files fails instantly: `rm *.log`, `ls *.json | ...`, or
`cp * /backup/` returns `/bin/rm: Argument list too long`. The glob is correct; there are
just too many matches.

The shell expands `*` into the full list of filenames and passes them as arguments to the
program. The kernel caps the total size of a program's arguments plus environment
(`ARG_MAX`). A directory with hundreds of thousands of files blows past that limit before
the command even starts.

## Your Task

- Reproduce `Argument list too long` with a large set of files.
- Explain where the limit comes from (shell expansion vs kernel `ARG_MAX`).
- Perform the operation without exceeding the limit.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
echo "creating many files (this is what triggers ARG_MAX on the real box)..."
# create enough files that '*' expansion is huge
for i in $(seq 1 200000); do : > "log-$i.log"; done
echo "created $(ls | wc -l) files"
echo "getconf ARG_MAX = $(getconf ARG_MAX) bytes"
echo "now try:  rm *.log"
```

## Expected Failure

```bash
bash setup.sh
cd lab
rm *.log
# bash: /bin/rm: Argument list too long
```

```bash
# the shell tried to build one huge argument vector:
echo *.log | wc -c
# a number larger than ARG_MAX
getconf ARG_MAX
# e.g. 2097152  (bytes for args + environment)
```

The shell expands `*.log` to every matching filename and hands them all to `rm` as
arguments. Their combined size exceeds `ARG_MAX`, so `exec` fails before `rm` runs. The
command is fine; the argument vector is too big.

## Expected Outcome

The operation completes without hitting the limit.

Using `find ... -delete` (no giant argv):

```bash
find . -maxdepth 1 -name '*.log' -delete
ls *.log 2>/dev/null | wc -l
# 0
```

Or `find ... -print0 | xargs -0`, which batches arguments under the limit:

```bash
find . -maxdepth 1 -name '*.log' -print0 | xargs -0 rm
```

Either way the files are gone and no `Argument list too long` occurs.

## Hints

### Hint 1 — The shell expands the glob, then execs

`rm *.log` becomes `rm log-1.log log-2.log ... log-200000.log` before `rm` starts. The
kernel limits the total bytes of arguments + environment to `ARG_MAX` (`getconf ARG_MAX`).
Too many/too-long filenames overflow it. The fix is to avoid building one enormous argument
list.

### Hint 2 — Use find, or xargs to batch

`find . -name '*.log' -delete` never constructs a shell argv at all. `find ... -print0 |
xargs -0 rm` streams filenames and splits them into multiple `rm` calls, each safely under
`ARG_MAX`. Use `-print0`/`-0` (NUL-separated) so spaces/newlines in names are handled
correctly. A `for f in *` loop does NOT help — the glob still expands first.

## Solution

The glob expansion exceeded `ARG_MAX`. Operate with `find` (no argv) or `xargs` (batched).

```bash
# best: find does the deletion itself, no argument vector
find . -maxdepth 1 -name '*.log' -delete

# or: batch via xargs, NUL-separated for safety
find . -maxdepth 1 -name '*.log' -print0 | xargs -0 rm

# xargs also parallelises if useful:
find . -maxdepth 1 -name '*.log' -print0 | xargs -0 -P4 -n1000 rm
```

- **The shell expands globs before exec.** `rm *.log` passes every filename as an argument;
  the error is about the *argument vector size*, not about `rm`. The command is correct.
- **`ARG_MAX` caps args + environment.** `getconf ARG_MAX` shows the limit; huge directories
  overflow it. A bloated environment reduces the room left for arguments, too.
- **`find -delete` / `find -exec` avoid the argv entirely**; `xargs` splits input into
  multiple commands each under the limit. Both scale to any number of files.
- **Always use `-print0` with `xargs -0`** (or `find -exec ... {} +`) so filenames with
  spaces, quotes or newlines are handled safely — space-splitting is a classic second bug.
- **A `for f in *` loop is not a fix** — the glob still expands in the shell first, hitting
  the same limit. Reach for `find`/`xargs` for large sets.
