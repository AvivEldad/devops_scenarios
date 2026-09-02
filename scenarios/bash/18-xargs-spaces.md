# xargs ran the command twice on one filename

## Briefing

`find . -name '*.log' | xargs rm` hits a file named `q4 report.log` and `rm`
looks for `q4` and `report.log`. Or `xargs -n 2` pairs arguments wrong. Or
`xargs` with no input still runs the command once (GNU vs BSD). Spaces, quotes,
and the default split rules make `xargs` as dangerous as unquoted globs.

`-0` / `-print0` is the contract with `find`. Without it, xargs is for toy
examples.

## Your Task

- Create a file with a space, pipe names to xargs, and show the split.
- Delete with `-print0` | `xargs -0`.
- Show GNU `xargs` running `echo` once with no input (and `-r` to skip).

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
touch "q4 report.log" keep.txt
echo "find . -name '*.log' | xargs rm"
```

## Expected Failure

```bash
bash setup.sh
cd lab
find . -name '*.log' | xargs rm
# rm: cannot remove './q4': No such file or directory
# rm: cannot remove 'report.log': No such file or directory
ls
# 'q4 report.log' still there
```

xargs split on spaces. `rm` received two arguments.

## Expected Outcome

The spaced filename is removed; `keep.txt` remains.

```bash
find . -name '*.log' -print0 | xargs -0 rm --
ls
# keep.txt
```

No-op on empty:

```bash
find . -name '*.none' -print0 | xargs -0 -r rm --
# does not run rm
```

## Hints

### Hint 1 — NUL is the only safe separator

`find -print0` / `grep -Z` / `git ls-files -z` pair with `xargs -0`. Spaces,
quotes, and newlines in names are then data, not syntax.

### Hint 2 — -r / --no-run-if-empty

BSD xargs (macOS) does not run with empty input; GNU does. `-r` is GNU.
Portable: `find ... -exec rm -f -- {} +` avoids xargs entirely.

## Solution

Use NUL or `-exec`.

```bash
find . -name '*.log' -print0 | xargs -0 -r rm --
# or:
find . -name '*.log' -exec rm -f -- {} +
```

- **Default xargs is IFS-split plus some quote parsing** — not "lines". `xargs
  -L1` is closer to lines, still breaks on spaces.
- **`xargs -P` parallel** is great until the command is not safe concurrently
  (same `-exec` caution).
- **`xargs -I{}`** one-at-a-time with a placeholder; still needs `-0` for
  spaces.
- **`rm` without `--`:** a file named `-f` or `-r` is a flag. `--` ends flags.
