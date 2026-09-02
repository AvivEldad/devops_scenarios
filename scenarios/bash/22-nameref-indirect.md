# nameref and ${!var} pointed at the wrong thing

## Briefing

A function takes the *name* of an array to fill: `fill result`. Inside, you
`eval "$1+=($x)"` or `declare -n ref=$1`. A caller passes `1` or `PATH` or
`ref`, and you clobber the nameref itself or a global. Indirect expansion
`${!prefix*}` lists variables; `${!var}` is the value of the name stored in
`var`. Mixing them is a CVE-shaped footgun (`eval`) or a silent empty array.

Indirect assignment is how bash implements "pass by name". It must be
restricted to known identifiers.

## Your Task

- Break `declare -n ref=$1` with a colliding name.
- Use `${!var}` vs `${!prefix@}` correctly.
- Fill an array by name without `eval`.

## Starter Files

### file: nameref.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

fill() {
  declare -n ref=$1
  ref+=(one two)
}

ref=(already)
fill ref
echo "ref=${ref[*]}"

name=PATH
echo "indirect PATH first char: ${!name}"
```

## Expected Failure

```bash
bash nameref.sh
# nameref.sh: line 6: declare: ref: circular name reference
# or: ref=one two already mixed
```

```bash
name=PATH
echo ${!name}
# /usr/bin:/bin:...     <- the VALUE of PATH, not the letters P A T H
```

`${!name}` when `name=PATH` is `$PATH`. People use it thinking "expand the
variable whose name I just built" which *is* correct — until `name` is
attacker-controlled.

## Expected Outcome

A safe fill by nameref with a validated identifier; prefix listing understood.

```bash
is_ident() { [[ $1 =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; }

fill() {
  is_ident "$1" || return 2
  declare -n _dst=$1
  _dst+=(one two)
}

out=()
fill out
echo "${out[*]}"
# one two
```

## Hints

### Hint 1 — nameref is an alias for a variable

`declare -n ref=out` makes `ref` another name for `out`. If `$1` is `ref`,
circular. Use a nameref name that cannot collide (`_dst`) and reject `$1` that
is not `^[a-zA-Z_][a-zA-Z0-9_]*$`.

### Hint 2 — ${!var} vs ${!prefix*}

`${!var}` = indirect: value of the variable named by `$var`. `${!prefix*}` /
`${!prefix@}` = list of variable names starting with `prefix`. Completely
different. `eval "$1=foo"` is the injection primitive; avoid it.

## Solution

Validate the name; use a private nameref.

```bash
fill() {
  [[ $1 =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "bad ident" >&2; return 2; }
  declare -n _fill_dst=$1
  _fill_dst+=(one two)
}
```

- **Never nameref untrusted strings** (filenames, CLI). That is eval with extra
  steps.
- **`printf -v "$var" '%s' "$val"`** assigns by name without eval, still needs
  a valid ident.
- **`declare -n` is bash 4.3+.** Older bash: `eval` with a whitelist only.
- **Read-only / `PATH` / `UID`:** filling those by name is a bad day. Blacklist
  too if you must be extra safe.
