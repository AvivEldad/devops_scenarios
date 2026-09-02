# The directory you cannot enter

## Briefing

You own a directory, it has read permission, and `cd` into it fails with `Permission
denied` — or you can `cd` in but cannot read the listing, or you can list names but not
access the files. Directory permission bits do not mean what file bits mean.

On a directory: `r` allows *listing names*, `w` allows *creating/deleting entries*, and `x`
(the crucial one) allows *traversing into it and accessing entries by name*. Without `x`
you cannot enter or stat anything inside, even with `r`.

## Your Task

- Create directories with `r` but no `x`, and with `x` but no `r`, and observe the
  difference.
- Explain what each of `r`, `w`, `x` means for a directory.
- Set permissions so you can traverse, list, and access files correctly.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir -p lab/readable-no-x lab/x-no-read
echo "data" > lab/readable-no-x/file.txt
echo "data" > lab/x-no-read/file.txt

chmod 644 lab/readable-no-x     # rw-r--r-- : r but no x  (cannot traverse)
chmod 711 lab/x-no-read         # rwx--x--x : x but no r  (cannot list)
echo "created:"
ls -ld lab/readable-no-x lab/x-no-read
```

## Expected Failure

```bash
bash setup.sh
cd lab

# r but no x: you can (sort of) see the name but cannot enter or stat contents
ls readable-no-x
# ls: cannot access 'readable-no-x/file.txt': Permission denied
# file.txt                                     <- name shown, but '?' metadata
cd readable-no-x
# bash: cd: readable-no-x: Permission denied

# x but no r: you can enter and access known names, but cannot list
ls x-no-read
# ls: cannot open directory 'x-no-read': Permission denied
cat x-no-read/file.txt
# data                                          <- works! you know the name and have x
```

Two different failures from two different missing bits: no `x` blocks *traversal* (cannot
enter or stat contents); no `r` blocks *listing* (cannot enumerate names) but still allows
access to names you already know.

## Expected Outcome

You can traverse, list, and read files normally.

The directory has `r-x` (list + traverse):

```bash
chmod 755 lab/readable-no-x lab/x-no-read
ls -ld lab/readable-no-x
# drwxr-xr-x ...
```

Everything works:

```bash
ls lab/readable-no-x
# file.txt
cd lab/readable-no-x && cat file.txt
# data
```

## Hints

### Hint 1 — Directory bits are not file bits

For a directory: `x` = "can enter/traverse and access entries by name" (the essential one),
`r` = "can list the names", `w` = "can create/delete entries". You need `x` to `cd` in or
to `stat`/open anything inside; `r` only lets you enumerate. This is why `755`
(`rwxr-xr-x`) is the normal directory mode.

### Hint 2 — Traversal needs x on every parent

To reach `/a/b/c/file`, you need `x` on `/`, `/a`, `/a/b`, and `/a/b/c` — a missing `x`
anywhere in the path blocks access below it. Use `namei -l /full/path` to see the
permissions of every path component at once and spot which one denies you.

## Solution

The directories were missing `x` (or `r`). Give directories `r-x` so you can list and
traverse.

```bash
# 755 = rwxr-xr-x: owner full, others list+traverse (normal for directories)
chmod 755 lab/readable-no-x lab/x-no-read

# check the whole path if access still fails deeper down:
namei -l lab/readable-no-x/file.txt

cd lab/readable-no-x && cat file.txt     # works
```

- **Directory permissions differ from file permissions.** `x` = traverse/access-by-name (the
  one people forget), `r` = list names, `w` = add/remove entries. A directory without `x` is
  a wall even if it is readable.
- **`755` is the standard directory mode** (`rwxr-xr-x`): you get full control, others can
  list and traverse. `700` keeps it private. Files are typically `644`/`600` — do not blanket
  a tree with file modes.
- **Traversal requires `x` on every parent.** One missing `x` high in the path denies
  everything beneath it. `namei -l /path/to/file` prints the mode of each component so you can
  find the offending directory instantly.
- **`r` without `x` gives you names but not access**; `x` without `r` gives you access to
  names you already know but no listing. Understanding this split explains most "I can see it
  but can't open it" (and vice versa) puzzles.
- **Beware recursive chmod.** `chmod -R 644` strips `x` from directories and breaks
  traversal; use `chmod -R a+X` (capital X adds `x` only to directories and already-executable
  files) or `find -type d`/`-type f` to set each correctly.
