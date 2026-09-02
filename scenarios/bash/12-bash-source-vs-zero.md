# \$0 is the wrapper, not this file

## Briefing

A library `lib.sh` does `cd "$(dirname "$0")"` to find sibling files. When you
`source lib.sh` from `bin/deploy`, `$0` is `bin/deploy` (or `-bash`), and the
library looks for files next to the wrong path. Cron sets `$0` to the script
name; `bash lib.sh` sets it to `lib.sh`; `source` does not.

`BASH_SOURCE[0]` is the path of the currently executing source file.
`${BASH_SOURCE[0]:-$0}` is the usual portable-enough pattern in bash.

## Your Task

- Source a library that uses `$0` and show it resolves the wrong directory.
- Switch to `BASH_SOURCE` so siblings resolve.
- Know what happens when `$0` is `-bash` / `bash`.

## Starter Files

### file: lib.sh

```bash
# intended to live next to data/config.ini
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "lib thinks DIR=$DIR"
echo "looking for $DIR/data/config.ini"
```

### file: bin/deploy

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"
```

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p lab/bin lab/data
# copy lib.sh to lab/, bin/deploy to lab/bin/
echo "ok" > lab/data/config.ini
```

## Expected Failure

```bash
bash bin/deploy
# lib thinks DIR=/path/lab/bin        <- dirname of deploy, not lib.sh
# looking for /path/lab/bin/data/config.ini
# (missing)
```

`$0` inside the sourced file is still `bin/deploy`.

## Expected Outcome

The library locates `data/config.ini` relative to `lib.sh`.

```bash
# lib thinks DIR=/path/lab
# file exists
```

## Hints

### Hint 1 — BASH_SOURCE[0]

Inside `lib.sh`: `here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)`. `$0` stays
the name of the *invocation*. For `source lib.sh`, `${BASH_SOURCE[0]}` is `lib.sh`.

### Hint 2 — Interactive and dash

Interactive bash: `$0` is `bash` or `-bash`. Sourcing from `.bashrc` must use
`BASH_SOURCE`. `sh` has no `BASH_SOURCE`; keep libraries bash-only or pass the
directory as an argument.

## Solution

Resolve against `BASH_SOURCE`.

```bash
# lib.sh
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config="${_here}/data/config.ini"
```

```bash
# bin/deploy
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
```

- **`$0` is for messages ("usage: $0") of the entrypoint**, not for locating
  sourced files.
- **`${BASH_SOURCE[1]}`** is the caller of a function — useful in logging, easy
  to confuse with `[0]`.
- **Symlinks:** `dirname` of `$0` may be the symlink location. `readlink -f` /
  `realpath` if you need the physical path.
- **Tests that `source` a script** hit this immediately; unit-test the path
  helper.
