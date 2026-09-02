# rm *.log deleted a file named *.log

## Briefing

A cleanup job runs `rm -f *.log` in an empty directory. Instead of deleting
nothing, it tries to delete a file literally named `*.log`, or `rm` errors
`No such file`. In a directory with one match it is fine. In a directory with
none, **globbing left the pattern unchanged** (bash default). Combined with a
poorly quoted variable, this becomes data loss.

`nullglob`, `failglob`, and `dotglob` change the rules. You need to know which
is on.

## Your Task

- Run a glob with zero matches and show the pattern is passed through.
- Enable `nullglob` or `failglob` and show the safer behaviours.
- Write a delete loop that is safe with zero, one, or many files.

## Starter Files

### file: cleanup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# run from an empty logs/ directory
cd logs
echo "about to: rm -f *.log"
# demonstrate what the glob becomes:
printf 'glob expands to: [%s]\n' *.log
rm -f *.log
```

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir -p lab/logs
# no .log files
echo "cd lab && bash ../cleanup.sh   (copy cleanup into lab first)"
```

## Expected Failure

```bash
mkdir -p lab/logs
cd lab/logs
printf 'glob expands to: [%s]\n' *.log
# glob expands to: [*.log]
touch -- '*.log'     # if someone created a literal file
rm -f *.log          # may delete the literal or do nothing useful
```

Default bash: unmatched `*.log` stays `*.log`. `rm -f *.log` then deletes a file
named `*.log` if it exists, or no-ops with `-f`. `set -u` does not catch this.

## Expected Outcome

Zero matches mean zero deletions; no literal `*.log` argument.

```bash
shopt -s nullglob
files=(*.log)
printf 'count=%s\n' "${#files[@]}"
# count=0
rm -f -- "${files[@]}"     # rm with zero args: still check; use a loop
```

With `failglob`, the script aborts on no match instead of passing the pattern.

## Hints

### Hint 1 — Default is pass-through

`man bash` / `shopt | grep glob`: unmatched glob = pattern string. `nullglob` =
expand to nothing. `failglob` = error. `dotglob` = include `.hidden`. Test with
`printf '<%s>\n' *.log` in an empty dir.

### Hint 2 — Arrays from globs

`files=(*.log)` with `nullglob` gives an empty array. `"${files[@]}"` must not
run `rm` with no operands if your `rm` complains — ` ((${#files[@]})) && rm -f --
"${files[@]}"`. Never `rm $pattern` unquoted.

## Solution

Turn on `nullglob` (or `failglob`) and iterate the array.

```bash
#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
cd logs
files=(*.log)
if ((${#files[@]} == 0)); then
  echo "nothing to clean"
  exit 0
fi
rm -f -- "${files[@]}"
```

- **Unmatched globs are not empty — they are the glob text.** That is the footgun.
- **`failglob` is better in CI** if no-match should be a broken assumption.
- **`**` needs `globstar`.** Without it `**/*.log` is just `*/*.log` with a
  peculiar `*`.
- **`rm --`** stops a file named `-f` from being a flag. Globs can produce those.
