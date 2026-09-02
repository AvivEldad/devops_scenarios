# 08 is not a number, and 1+1 is 11

## Briefing

A script computes `NEXT=$(($MONTH + 1))` and blows up on August: `value too great
for base`. Another concatenates `VERSION=$MAJOR+$MINOR` and ships `1+2` instead of
`3`. Bash arithmetic is `$(( ))` / `(( ))` / `let`. Unquoted `+` in strings is not
addition. Leading zeros are octal.

These bugs pass for months (`01`–`07`) and fail in October (`08`, `09`) or when
someone treats a version string as math.

## Your Task

- Reproduce octal `08` failure and string `+` concatenation.
- Write arithmetic that accepts `08` as eight and adds integers.
- Keep version strings out of `$(( ))`.

## Starter Files

### file: bump.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
MONTH="${1:-08}"
MAJOR=1
MINOR=2
NEXT=$((MONTH + 1))
echo "next month: $NEXT"
VERSION=$MAJOR+$MINOR
echo "version: $VERSION"
```

## Expected Failure

```bash
bash bump.sh 08
# bump.sh: line 6: 08: value too great for base (error token is "08")
```

```bash
bash bump.sh 7
# next month: 8
# version: 1+2          <- not 3
```

`$((MONTH + 1))` parses `08` as octal. `$MAJOR+$MINOR` is string concatenation
because it is not inside arithmetic context.

## Expected Outcome

August becomes 9; version math is explicit.

```bash
bash bump.sh 08
# next month: 9

# version bump as integers:
# version: 3
```

`10` still becomes `11`, not octal-surprises.

## Hints

### Hint 1 — Leading zeros are octal in $(( ))

`$((10#$MONTH + 1))` forces base 10. `MONTH=$((10#$MONTH))` before math. Or strip:
`MONTH=${MONTH#0}` carefully (`00` is a trap). `date +%-m` avoids the zero on GNU.

### Hint 2 — Concatenation vs addition

`VERSION=$MAJOR+$MINOR` is characters `1`, `+`, `2`. `VERSION=$((MAJOR + MINOR))`
is math. `VERSION="${MAJOR}.${MINOR}"` is a version string — do not add those.

## Solution

Force base 10; use `$(( ))` only for integers.

```bash
#!/usr/bin/env bash
set -euo pipefail
MONTH="${1:-08}"
MAJOR=1
MINOR=2
NEXT=$((10#$MONTH + 1))
echo "next month: $NEXT"
VERSION=$((MAJOR + MINOR))
echo "sum: $VERSION"
echo "dotted: ${MAJOR}.${MINOR}"
```

- **`08`/`09` fail once a year** in cron month scripts. Base-10 prefix is the fix.
- **`let NEXT=MONTH+1` has the same octal rule.** `((MONTH++))` too.
- **Floats:** bash has no floats; use `awk`/`bc`. `$((3/2))` is `1`.
- **`expr` is legacy** and has the same quoting pitfalls as `[`. Prefer `$(( ))`.
