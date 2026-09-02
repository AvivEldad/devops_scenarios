# getopts swallowed the argument after -f

## Briefing

`deploy.sh -f -v file` or `deploy.sh -fenv` behaves oddly: `-f` requires a file,
`-v` is verbose, and users write `-fv` / put the file in the wrong place.
`getopts` is the POSIX way; `$@` shifting by hand double-counts. A missing
`:` after the option letter makes `-f` a boolean and the filename becomes a
positional that you then ignore.

Wrong `getopts` strings are how flags eat the next command.

## Your Task

- Parse `-f file`, `-v`, and a remaining positional with `getopts`.
- Reproduce a missing `:` so the filename is not the optarg.
- Reject unknown flags (`?`) instead of silently continuing.

## Starter Files

### file: deploy.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# intended: -f FILE (required arg), -v (boolean)
FILE=""
VERBOSE=0
while getopts "fv" opt; do
  case "$opt" in
    f) FILE="$OPTARG" ;;
    v) VERBOSE=1 ;;
    *) exit 2 ;;
  esac
done
shift $((OPTIND - 1))
echo "file=[$FILE] verbose=$VERBOSE rest=[$*]"
```

## Expected Failure

```bash
bash deploy.sh -f app.tar
# deploy.sh: line 8: OPTARG: unbound variable     # or FILE empty
# file=[] verbose=0 rest=[app.tar]
```

`getopts "fv"` — `f` has no `:`, so `-f` does not take an argument. `app.tar`
is leftover positional. `FILE="$OPTARG"` is empty/unbound under `set -u`.

```bash
bash deploy.sh -fapp.tar
# treated as unknown cluster or FILE=app.tar depending on the string
```

## Expected Outcome

```bash
bash deploy.sh -v -f app.tar prod
# file=[app.tar] verbose=1 rest=[prod]

bash deploy.sh -vf app.tar
# file=[app.tar] verbose=1 rest=[]
```

Unknown `-z` exits 2.

## Hints

### Hint 1 — Colon means argument

`getopts "vf:n:"` — `v` boolean, `f` and `n` require args. The colon **after**
the letter. A leading `:` in the optstring changes silent error handling
(`OPTARG` on `?`/`:`).

### Hint 2 — OPTIND shift

After the loop, `shift $((OPTIND - 1))` leaves positionals. Forgetting shift
means `$1` is still `-f`. Combined flags `-vf file` need `f:` so `file` is
optarg.

## Solution

Put `:` after `f`; handle errors.

```bash
#!/usr/bin/env bash
set -euo pipefail
FILE=""
VERBOSE=0
while getopts ":vf:" opt; do
  case "$opt" in
    f) FILE="$OPTARG" ;;
    v) VERBOSE=1 ;;
    :) echo "missing arg for -$OPTARG" >&2; exit 2 ;;
    \?) echo "unknown -$OPTARG" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
[[ -n $FILE ]] || { echo "need -f FILE" >&2; exit 2; }
echo "file=[$FILE] verbose=$VERBOSE rest=[$*]"
```

- **`getopt` (GNU, no s) is not `getopts`.** GNU `getopt` supports `--long` and
  is easy to misuse with spaces. Prefer `getopts` for portability or a dedicated
  parser.
- **`OPTARG` and `set -u`:** only valid in the `f)` / `:` branches.
- **`--`** ends options; `getopts` stops. Users with filenames starting with `-`
  need `--`.
- **Do not `shift` inside the case** while using `getopts` — it uses `OPTIND`.
