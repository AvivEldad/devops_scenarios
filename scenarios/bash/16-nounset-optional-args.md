# set -u vs optional arguments

## Briefing

`set -u` (`nounset`) is in every serious script. Then `deploy.sh` with no args
crashes: `unbound variable` on `$1` or `${args[0]}`. You need optional flags
(`VERBOSE=${1:-}`) without turning `set -u` off for the whole file.

`${1:-default}`, `${1-default}` (unset vs empty), and `$#` are the tools. `$1`
bare is not.

## Your Task

- Run a `set -u` script with zero args and reproduce `unbound variable`.
- Accept 0–2 optional arguments safely.
- Distinguish unset from empty string if it matters.

## Starter Files

### file: deploy.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
ENV="$1"
TAG="$2"
echo "deploying $TAG to $ENV"
```

## Expected Failure

```bash
bash deploy.sh
# deploy.sh: line 3: $1: unbound variable
```

```bash
bash deploy.sh staging
# deploy.sh: line 4: $2: unbound variable
```

The script cannot even print usage.

## Expected Outcome

Zero args prints usage and exits 2. One arg uses a default tag. Two args work.

```bash
bash deploy.sh
# usage: deploy.sh <env> [tag]
# (exit 2)

bash deploy.sh staging
# deploying latest to staging

bash deploy.sh staging v1.2.3
# deploying v1.2.3 to staging
```

## Hints

### Hint 1 — ${1:-} is bound

`${1:-latest}` expands to `latest` if `$1` is unset **or** empty. Under `set -u`
this is allowed. `$1` is not. `${1-default}` (no colon) only substitutes when
unset, not when empty.

### Hint 2 — Check $# first

```bash
if (($# < 1)); then echo usage; exit 2; fi
```

`$#` is always set. `"$@"` with no args is empty list, not unbound.

## Solution

Require env; default tag.

```bash
#!/usr/bin/env bash
set -euo pipefail
if (($# < 1)); then
  echo "usage: $0 <env> [tag]" >&2
  exit 2
fi
ENV="$1"
TAG="${2:-latest}"
echo "deploying $TAG to $ENV"
```

- **`set -u` is worth keeping.** Optional values go through `${var:-}` / `$#`.
- **`"${var:?message}"`** aborts with a custom error if unset/empty — good for
  required env vars: `: "${AWS_REGION:?set AWS_REGION}"`.
- **Functions:** `$1` inside a function is the function arg, not the script's.
  Name them (`local env=$1`).
- **`nounset` + `arr[i]`** — see arrays drill; same class of bug.
