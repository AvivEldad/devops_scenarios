# The while loop forgot every variable

## Briefing

You pipe `find | while read f; do n=$((n+1)); done` then `echo $n` and it is
empty/0. The loop ran; the count lived in a **subshell**. The same happens with
`cat file | while read`. Process substitution `while read; do ...; done < <(find)`
keeps the loop in the current shell.

This is the data-side of "cd in a pipeline": pipes create subshells.

## Your Task

- Count files with a piped while-loop and show the count is lost.
- Rewrite with process substitution or a for-loop so the count remains.
- Know bash `lastpipe` as an optional third way.

## Starter Files

### file: count.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
n=0
printf '%s\n' a b c | while read -r f; do
  n=$((n + 1))
  echo "saw $f n=$n"
done
echo "after loop n=${n}"
```

## Expected Failure

```bash
bash count.sh
# saw a n=1
# saw b n=2
# saw c n=3
# after loop n=0
```

The `while` body ran in the subshell created by the pipe. `n=0` in the parent
never changed.

## Expected Outcome

After the loop, `n` is 3.

```bash
# after loop n=3
```

## Hints

### Hint 1 — Process substitution

`while read -r f; do n=$((n+1)); done < <(printf '%s\n' a b c)` — the while is
not in a pipeline, so it is not a subshell. `<( )` is a FIFO/file the while
reads.

### Hint 2 — lastpipe and arrays

`shopt -s lastpipe` (bash, non-interactive needs `set +m` job-control off) runs
the last stage in the current shell. Portable: avoid the pipe. `mapfile -t files <
<(find ...)` then `"${#files[@]}"`.

## Solution

Read from process substitution (or a temp file).

```bash
#!/usr/bin/env bash
set -euo pipefail
n=0
while IFS= read -r f || [[ -n $f ]]; do
  n=$((n + 1))
done < <(printf '%s\n' a b c)
echo "after loop n=${n}"
```

- **Any variable assignment in a piped `while` is discarded.** Counters, maps,
  `found=1` flags — all gone.
- **`find ... -print0 | while read -d ''`** has the same subshell issue; use
  `find -exec` or process substitution with `-d ''`.
- **`( n=1 )`** is an explicit subshell; `{ n=1; }` is not.
- **Functions that pipe to while** are a common source of "it works in the
  function's echo and returns empty".
