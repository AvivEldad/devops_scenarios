# read ate the leading spaces and the last line

## Briefing

You parse a file with `while read line; do ...; done < file`. Lines with leading
spaces lose them. The last line is skipped if the file has no trailing newline.
A CSV-ish line `a:b:c` split on `IFS=:` works until a field is empty (`a::c`).

`read` uses IFS to split and trim, and it returns non-zero at EOF even if it
assigned a partial last line — so `while read` drops that line under `set -e`
or when you test `read`'s exit status.

## Your Task

- Read a file that has indented lines and no final newline; show the data loss.
- Fix IFS, `-r`, and the while-read idiom so every line is preserved.
- Split fields without collapsing empties the wrong way.

## Starter Files

### file: data.txt

```text
  indented
middle
no-nl-at-end
```

### file: read.sh

```bash
#!/usr/bin/env bash
# last line in data.txt has no newline — recreate with printf if needed
while read line; do
  echo "got:[$line]"
done < data.txt
```

## Expected Failure

```bash
printf '  indented\nmiddle\nno-nl-at-end' > data.txt   # no trailing newline
bash read.sh
# got:[indented]       <- leading spaces stripped
# got:[middle]
#                       <- last line missing
```

IFS default trims leading/trailing whitespace. `read` exits 1 on EOF without
newline, so `while read` stops without processing that iteration.

## Expected Outcome

All three lines, spaces preserved (if you want them).

```bash
# got:[  indented]
# got:[middle]
# got:[no-nl-at-end]
```

## Hints

### Hint 1 — read -r and empty IFS

`read -r line` disables backslash escapes. `IFS= read -r line` does not trim
spaces. The loop:

```bash
while IFS= read -r line || [[ -n $line ]]; do
  ...
done
```

The `|| [[ -n $line ]]` keeps the last partial line.

### Hint 2 — set -e vs read

`set -e` + `read` at EOF can abort the script. The `|| [[ -n $line ]]` pattern
also makes the while-condition succeed. `mapfile -t lines < file` (bash 4)
avoids the loop issue entirely but still needs `-t` and a newline at EOF for
some versions — `mapfile` keeps the last partial line.

## Solution

Use `IFS= read -r` and accept the last partial line.

```bash
#!/usr/bin/env bash
while IFS= read -r line || [[ -n $line ]]; do
  echo "got:[$line]"
done < data.txt
```

- **Default IFS trim is why `read` is wrong for indented code or YAML.**
- **`-r` is almost always what you want**; otherwise `\n` in the file becomes a
  real newline in the value.
- **`read a b c` with extra fields** dumps the rest into the last variable. Too
  few fields leave empties — quote and count.
- **Process substitution `while read; do ...; done < <(cmd)`** keeps the loop in
  the current shell (variables persist); pipe to while is a subshell.
