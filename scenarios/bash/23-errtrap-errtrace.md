# trap DEBUG and ERR that never fired

## Briefing

You set `trap 'cleanup' EXIT` (good) and `trap 'on_err' ERR` (maybe). A failure
inside a function, pipeline, or command substitution does not run `ERR`.
`set -E` (`errtrace`) is required for ERR traps to inherit into functions. `DEBUG`
traps run before every command and can recurse if the trap handler is not
guarded. Signal traps (`INT`) vs `ERR` vs `EXIT` have different rules — the
expert companion to the beginner lock-file trap drill.

## Your Task

- Install an ERR trap without `-E`, fail inside a function, and show the trap
  skipped.
- Enable `errtrace` and show it runs.
- Avoid DEBUG recursion.

## Starter Files

### file: traps.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
trap 'echo ERR_TRAP status=$?' ERR

inner() {
  false
  echo "after false in inner"
}

inner
echo "after inner"
```

## Expected Failure

```bash
bash traps.sh
# (script exits on false due to set -e; ERR trap may NOT print)
# or prints ERR_TRAP only at top-level, not from inner
```

Without `set -E`, bash does not run `ERR` traps in function context the way you
expect (and `set -e` may abort before). Pipelines need `pipefail` + `ERR` still
may not fire for every stage.

## Expected Outcome

Failing `false` inside `inner` prints `ERR_TRAP` and you understand `EXIT` still
runs cleanup.

```bash
set -Eeo pipefail
trap 'echo ERR_TRAP status=$? line=$LINENO' ERR
trap 'echo cleanup' EXIT
```

DEBUG handler uses `functrace` carefully and does not call commands that re-enter
DEBUG without `set +T` around the handler.

## Hints

### Hint 1 — ERR is not POSIX

`trap ... ERR` is bash. It fires when a command returns non-zero in a context
that would trigger `set -e` (roughly). `set -E` copies the trap to functions and
subshells. `COMMAND_NOT_FOUND` is separate.

### Hint 2 — EXIT always, ERR sometimes

Cleanup belongs on `EXIT` (and maybe `INT`/`TERM`). Logging the failed command
belongs on `ERR` with `$BASH_COMMAND` / `$LINENO`. Do not `exit` inside ERR
without thinking — you can skip EXIT or double-run it depending on `set -e`.

## Solution

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo ERR at $LINENO: $BASH_COMMAND (status=$?)' ERR
trap 'echo cleanup' EXIT

inner() { false; }
inner
```

- **`set -e` without `-E`:** functions swallow ERR traps. Always pair them if
  you use ERR.
- **Subshell `( false )`:** ERR in the parent may not see it; status is the
  subshell's.
- **`trap - ERR`** to disable around a command you expect to fail (`grep`).
- **DEBUG + `extdebug` + `return 1`** can skip commands — a debugger feature,
  not a linter. Easy to freeze a shell if the trap errors.
