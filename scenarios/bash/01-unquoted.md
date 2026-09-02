# The backup script that deletes the wrong thing

## Briefing

A nightly script archives a project directory and then clears its scratch folder. It
has worked for two years.

Last week someone created a project called `Q4 Reports`, with a space in the name.
The script reported success and the scratch folder was not cleared — but a directory
called `Reports` that nobody had heard of appeared in the backup root, and a file in
the parent directory went missing.

Nothing errored. The script's own success message printed exactly as usual.

## Your Task

Save the script and reproduce the damage in a sandbox, then fix it.

1. Run it against a path with a space and observe what it actually does.
2. Identify every place where an unquoted expansion changes the meaning of a command.
3. Fix them, and add the guards that would have made the failure loud instead of
   silent.

Work only inside your lab directory. The point of this exercise is to see how a
script destroys the wrong thing, so do not run it anywhere you care about.

```bash
mkdir -p ~/breakfix/bash-01 && cd ~/breakfix/bash-01
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Builds a sandbox that reproduces the incident.
set -euo pipefail

rm -rf lab && mkdir -p lab
cd lab

mkdir -p "projects/Q4 Reports/scratch"
echo "quarterly numbers" > "projects/Q4 Reports/report.txt"
echo "temp data"         > "projects/Q4 Reports/scratch/tmp.dat"

# an innocent bystander that the broken script will hit
mkdir -p backups
echo "do not lose me" > backups/important.txt

echo "sandbox ready in $(pwd)"
find . | sort
```

### file: backup.sh

```bash
#!/usr/bin/env bash

SRC=$1
DEST=./backups
NAME=$(basename $SRC)

echo "backing up $SRC"

mkdir -p $DEST/$NAME
cp -r $SRC/* $DEST/$NAME/

FILES=$(find $SRC -type f | wc -l)
echo "copied $FILES files"

# clear the scratch directory
SCRATCH=$SRC/scratch
rm -rf $SCRATCH/*

echo "backup of $NAME complete"
```

## Expected Failure

```bash
bash setup.sh
cd lab
bash ../backup.sh "projects/Q4 Reports"
```

The output looks entirely normal:

```
backing up projects/Q4 Reports
copied 0 files
backup of Reports complete
```

Now look at what really happened:

```bash
find . | sort
```

```
./backups
./backups/Q4              <- a directory called "Q4"
./backups/Reports         <- and another called "Reports"
./projects/Q4 Reports/scratch/tmp.dat    <- never cleared
```

The script split the argument on the space and treated it as two separate paths.
`basename` received two arguments and returned only the last. `mkdir -p $DEST/$NAME`
became `mkdir -p ./backups/Q4 Reports`, which creates **two** directories. The copy
found nothing, the file count was wrong, and the scratch clear silently targeted the
wrong path.

Then try the case that shows how bad this gets:

```bash
cd ~/breakfix/bash-01 && bash setup.sh && cd lab
bash ../backup.sh ""            # empty argument
```

With `SRC` empty, `SCRATCH=/scratch` and the script runs `rm -rf /scratch/*`. In this
sandbox that path does not exist. On a real server running as root, it does something
you cannot undo.

## Expected Outcome

The script handles paths with spaces correctly and refuses unsafe input.

A normal run with a space in the path works end to end:

```bash
cd ~/breakfix/bash-01 && bash setup.sh && cd lab
bash ../backup.sh "projects/Q4 Reports"; echo "exit=$?"
```

```
backing up projects/Q4 Reports
copied 2 files
backup of Q4 Reports complete
exit=0
```

Exactly one backup directory is created, with the correct name and contents:

```bash
ls backups/
# important.txt   'Q4 Reports'

ls "backups/Q4 Reports/"
# report.txt  scratch

cat "backups/Q4 Reports/report.txt"
# quarterly numbers
```

The scratch directory really was cleared, in the right place:

```bash
ls -A "projects/Q4 Reports/scratch/"
# (empty)
```

The bystander file is untouched:

```bash
cat backups/important.txt
# do not lose me
```

Bad input is rejected loudly instead of doing something destructive:

```bash
bash ../backup.sh; echo "exit=$?"
# usage: backup.sh <source-directory>
# exit=2

bash ../backup.sh ""; echo "exit=$?"
# error: source directory must not be empty
# exit=2

bash ../backup.sh /does/not/exist; echo "exit=$?"
# error: not a directory: /does/not/exist
# exit=2
```

And it passes the linter with no warnings:

```bash
shellcheck backup.sh && echo "shellcheck clean"
```

## Hints

### Hint 1 — Word splitting is the whole bug

When bash expands an unquoted `$SRC`, it splits the result on whitespace (every
character in `IFS`) and then glob-expands each piece. So this:

```bash
SRC="projects/Q4 Reports"
cp -r $SRC/* dest/
```

becomes `cp -r projects/Q4 Reports/* dest/` — three arguments, none of which is the
path you meant.

Quoting suppresses both splitting and globbing:

```bash
cp -r "$SRC"/* dest/
```

Note where the quote ends. `"$SRC"/*` quotes the variable while leaving the glob
active, which is what you want here.

### Hint 2 — Quote every expansion, including the ones that "look safe"

`$(basename $SRC)`, `$DEST/$NAME`, `$(find $SRC ...)` — each is a separate instance
of the same bug. The rule with almost no exceptions: **every** `$var` and `$(cmd)`
goes in double quotes unless you have a specific, deliberate reason for splitting.

Also prefer `${var}` bracing when concatenating: `"${DEST}/${NAME}"` is unambiguous.

### Hint 3 — Unset and empty variables are the dangerous case

`rm -rf $SCRATCH/*` with an empty `SCRATCH` expands to `rm -rf /*`.

`set -u` makes an *unset* variable an error, which catches typos like `$SCRACH`. It
does not catch a variable that is set to the empty string, so you still need an
explicit check. `${1:?usage: backup.sh <source-directory>}` refuses both unset and
empty in one expression.

### Hint 4 — Fail fast, and validate before destroying

Add `set -euo pipefail` at the top:

- `-e` exits on any command failure, so a failed `cp` cannot be followed by an `rm`
- `-u` errors on unset variables
- `-o pipefail` makes a pipeline fail if any stage fails, not just the last

Then validate: the argument exists, is non-empty, is a directory, and — for anything
that deletes — that the target is what you expect. Ordering matters: verify the copy
succeeded before clearing the source.

### Hint 5 — Let a tool find the rest

```bash
shellcheck backup.sh
```

ShellCheck flags every unquoted expansion with an explanation and a suggested fix.
Run it on every script you write; wire it into CI. It catches this entire class of
bug mechanically, which is better than remembering.

## Solution

Every unquoted expansion in the original is a defect. Here is the corrected script
with the guards that make it safe to run unattended.

```bash
#!/usr/bin/env bash
# Archive a project directory, then clear its scratch folder.
set -euo pipefail

usage() {
  echo "usage: ${0##*/} <source-directory>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage

SRC="${1:?}"
DEST="./backups"

[[ -n "$SRC" ]]  || { echo "error: source directory must not be empty" >&2; exit 2; }
[[ -d "$SRC" ]]  || { echo "error: not a directory: $SRC" >&2; exit 2; }

NAME="$(basename -- "$SRC")"
TARGET="${DEST}/${NAME}"

echo "backing up $SRC"

mkdir -p -- "$TARGET"

# -a preserves attributes; the trailing /. copies contents including dotfiles
cp -a -- "$SRC/." "$TARGET/"

FILES="$(find "$SRC" -type f | wc -l)"
echo "copied $FILES files"

# only clear scratch once the copy has demonstrably succeeded
SCRATCH="${SRC}/scratch"
if [[ -d "$SCRATCH" && -d "$TARGET" ]]; then
  find "$SCRATCH" -mindepth 1 -delete
fi

echo "backup of $NAME complete"
```

Verify:

```bash
cd ~/breakfix/bash-01 && bash setup.sh && cd lab
bash ../backup.sh "projects/Q4 Reports"
find . | sort
shellcheck ../backup.sh
```

Details worth understanding, because they each prevent a different accident:

- **`--` before filename arguments** stops a path beginning with `-` from being read
  as an option. A file called `-rf` is a real attack, and `basename -- "$SRC"`,
  `mkdir -p -- "$TARGET"` and `cp -a -- ...` all close it.
- **`cp -a "$SRC/." "$TARGET/"`** copies the directory *contents* including hidden
  files. The original `"$SRC"/*` silently skips dotfiles, because glob does not match
  a leading dot by default — a very common data-loss bug in backup scripts.
- **`find "$SCRATCH" -mindepth 1 -delete`** instead of `rm -rf "$SCRATCH"/*`. It
  handles dotfiles, cannot be affected by glob expansion, and `-mindepth 1` guarantees
  the directory itself survives.
- **Deleting only after verifying the copy** means a failed backup leaves the source
  intact. `set -e` already aborts on a failed `cp`, and the explicit `[[ -d "$TARGET" ]]`
  makes the dependency visible to the next reader.
- **`"${1:?}"`** aborts with a message if the argument is unset or empty, so the
  empty-string path that produced `rm -rf /*` can no longer be reached.

## What You Learned

The failure was silent, and that is the part to remember. Word splitting does not
produce an error — it produces a *different command*, which then succeeds. The script
printed its usual success message while creating two wrong directories, copying
nothing, and aiming a recursive delete at a path nobody intended.

Two habits eliminate this class of bug permanently: quote every expansion by default,
and run ShellCheck on everything. Then add the operational discipline that matters
more than either — validate input before any destructive operation, and never let a
delete run before you have confirmed the thing it depends on actually worked.
