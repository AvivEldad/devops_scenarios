# IFS=, turned every line into one field

## Briefing

You parse `csv` with `IFS=, read a b c`. After the loop, `ls` is broken, or
filenames with spaces split, or `$*` joins with commas. You set `IFS` globally
and never restored it. Or you needed `IFS=,` only for `read` and instead
exported it for the rest of the script.

IFS is among the most dangerous global variables in the shell: it changes
**every** unquoted expansion.

## Your Task

- Set `IFS=,` globally, then `echo $files` / `for f in $files` and show the
  damage.
- Restore IFS (or scope it to `read`).
- Join an array with commas without changing global IFS permanently.

## Starter Files

### file: parse.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=,
read -r host port proto <<< "db.internal,5432,tcp"
echo "host=$host port=$port proto=$proto"
files="a.conf b.conf"
echo unquoted: $files
for f in $files; do echo "iter:$f"; done
```

## Expected Failure

```bash
bash parse.sh
# host=db.internal port=5432 proto=tcp     <- parse worked
# unquoted: a.conf b.conf                  <- wait, spaces didn't split...
# iter:a.conf b.conf                       <- ONE iteration: IFS is comma, not space
```

Word splitting now only happens on commas. Space-separated lists become a single
word. Later `cmd $args` does not split arguments. Or conversely, a filename
containing `,` splits.

## Expected Outcome

CSV parse works; the rest of the script still splits on default IFS.

```bash
# host=... port=... proto=...
# iter:a.conf
# iter:b.conf
```

`echo "$IFS" | cat -A` after the read shows default whitespace IFS.

## Hints

### Hint 1 — Prefix the command

`IFS=, read -r host port proto` sets IFS only for that `read`. The rest of the
script is untouched. `read -ra fields <<< "$line"` into an array.

### Hint 2 — Save and restore

`old=$IFS` is wrong if IFS is whitespace (hard to round-trip). Use
`old_IFS=$IFS` still works for whitespace as the value is stored. Safer:
`IFS=, read ...` prefix. To join: `IFS=,; echo "${arr[*]}"` in a subshell
`(IFS=,; echo "${arr[*]}")`.

## Solution

Scope IFS to the `read`; join in a subshell.

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=, read -r host port proto <<< "db.internal,5432,tcp"
echo "host=$host port=$port proto=$proto"

files=(a.conf b.conf)
for f in "${files[@]}"; do echo "iter:$f"; done

( IFS=,; echo "${files[*]}" )
```

- **Unquoted `$files` uses IFS.** Quoted `"$files"` does not split. Arrays
  `"${files[@]}"` are the real fix.
- **Default IFS is space-tab-newline**, not "whitespace you think". CR (`\r`) is
  not IFS — CRLF lines leave `\r` on the last field.
- **Never `export IFS`.** Child processes inherit a broken world.
- **`$*` vs `$@`:** `"$*"` joins with first IFS character; `"$@"` stays separate.
