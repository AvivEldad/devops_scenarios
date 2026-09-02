# Associative array keys that look like numbers

## Briefing

`declare -A map` then `map[08]=aug` and `map[8]=eight` — or you iterate
`${!map[@]}` and the order is hash-random. Or `map[$key]` with `key=path/file`
and bash thinks it is arithmetic. Associative arrays are bash 4+; they are not
sorted; keys are strings except when the subscript is parsed as arithmetic for
**indexed** arrays.

Mixing `declare -a` and `declare -A`, or forgetting `-A`, stores `08` as index
`8` (octal) on an indexed array.

## Your Task

- Store keys `08` and `8` on both indexed and associative arrays; compare.
- Iterate keys without assuming order.
- Use a key that contains spaces or `/`.

## Starter Files

### file: assoc.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
declare -a idx
idx[08]=aug
idx[8]=eight
echo "idx[8]=${idx[8]} len=${#idx[@]}"

declare -A as
as[08]=aug
as[8]=eight
echo "as[08]=${as[08]} as[8]=${as[8]} keys=${!as[*]}"
```

## Expected Failure

```bash
bash assoc.sh
# idx[8]=eight len=1          <- 08 was octal 8, same slot
# as[08]=aug as[8]=eight keys=8 08   (order not guaranteed)
```

On an indexed array, `08` and `8` collide. A later `for k in "${!idx[@]}"`
looks like one month went missing.

## Expected Outcome

Associative array keeps both string keys; iteration is explicit.

```bash
declare -A as
as[08]=aug
as[8]=eight
printf '%s=%s\n' "08" "${as[08]}" "8" "${as[8]}"
for k in "${!as[@]}"; do
  printf 'key[%s]=%s\n' "$k" "${as[$k]}"
done
```

Path key:

```bash
as["foo/bar"]=1
echo "${as[foo/bar]}"
```

## Hints

### Hint 1 — declare -A before first assignment

`map[key]=val` without `-A` creates an indexed array; `key` is an arithmetic
expression (`foo` is 0 if unset with `set +u` — a famous bug). Always
`declare -A map` first.

### Hint 2 — Subscripts

`${as[$k]}` must quote `"$k"` if it has spaces. `${as[foo bar]}` is two words.
Do not sort `${!as[@]}` unless you `IFS=$'\n' sort`.

## Solution

```bash
declare -A month
month[08]=August
month[8]=eight
[[ ${month[08]} == August && ${month[8]} == eight ]]
```

- **Indexed: numbers (octal/hex traps). Associative: strings.** Pick one.
- **Need sorted keys:** `mapfile -t keys < <(printf '%s\n' "${!as[@]}" | sort)`.
- **Bash 3 (macOS system bash)** has no `declare -A`. Use `bash` 4+ or parallel
  arrays.
- **`${as[@]}` values, `${!as[@]}` keys.** Same `@` vs `*` quoting rules as
  lists.
