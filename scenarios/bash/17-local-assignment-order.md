# local foo=bar bash considers unset

## Briefing

A function does `local n=$(false)` or `local x=1 y=$x` and you get unexpected
empty values or `set -e` not firing. `local` is a command: `local a=1 b=$a`
assigns `b` from the *previous* `a`, and `local n=$(cmd)` captures the status of
`local`, not `cmd`, for `set -e` purposes.

`local` / `declare` / `export` in the same statement as an assignment have
subtle evaluation order.

## Your Task

- Write a function where `local x=1 y=$x` does not set `y` to 1.
- Show `local n=$(false)` vs `n=$(false)` under `set -e`.
- Split `local` and assignment.

## Starter Files

### file: fn.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

f() {
  local x=1 y=$x
  echo "y=$y"
}

g() {
  local n
  n=$(echo 1; false)
  echo "n=$n (should have aborted before this if set -e saw false)"
}

f
g
```

## Expected Failure

```bash
bash fn.sh
# y=                 <- y=$x used outer/empty x, not the new local 1
# n=1 (should have aborted...)
```

`local x=1 y=$x`: `$x` is expanded *before* `local` runs, so it is the outer `x`
(unset). `local n=$(false)` — wait, in `g` we split `local n` then `n=$(...)`.
The `$(echo 1; false)` returns 1 as output; the substitution's exit status is
`false` (last command). With `set -e` this *should* abort on `n=$(...)` in
modern bash... unless `local n=$(false)` swallows it.

Classic:

```bash
f() { local n=$(false); echo survived; }
set -e
f
# survived          <- local's status is 0
```

## Expected Outcome

`y=1`, and a failing command substitution aborts.

```bash
f() {
  local x=1
  local y=$x
  echo "y=$y"
}

g() {
  local n
  n=$(false)
  echo "dead"
}
```

## Hints

### Hint 1 — local is a command, not syntax

All assignments in `local a=1 b=$a` are parsed, then expansions happen, then
`local` is invoked. Split lines. Same for `export` and `declare`.

### Hint 2 — set -e and local

`local x=$(false)` exits 0 because `local` succeeded. Assign on a separate line:
`local x; x=$(false)`.

## Solution

One assignment per line; never `local var=$(...)`.

```bash
f() {
  local x=1
  local y=$x
  echo "y=$y"
}

g() {
  local n
  n=$(cmd)          # set -e honours cmd
}
```

- **`declare -n ref=name` (nameref)** has its own evaluation traps — next expert
  drill.
- **`local -`** and `local -x` are flags; `local VAR=1` is enough.
- **ksh `function` vs bash `f()`** differ on locals; stay in bash `f()` +
  `local`.
- **`unset` a local** reveals the outer variable again — shadowing, not a copy
  unless you assigned.
