# The if that is always true

## Briefing

A health-check script uses `[ $STATUS = 0 ]` or `[[ $STATUS = 0 ]]`. It always takes
the success branch — or errors `unary operator expected` depending on quoting. A
classic cousin: `[ $a -gt $b ]` with empty variables, or `==` inside `[ ]` that
some `/bin/sh` reject.

`[` is a command (`test`). `[[` is bash syntax. They parse `*`, empty strings, and
`=` vs `-eq` differently. Mixing them is how a check becomes a no-op.

## Your Task

- Run the broken tests and show they mis-classify empty and glob values.
- Rewrite them with `[[` (or quoted `[` and `-eq`) so they mean what they say.
- Know when you still need `[` (`/bin/sh` portability).

## Starter Files

### file: check.sh

```bash
#!/usr/bin/env bash
# Broken status checks. Run: bash check.sh
STATUS=""          # simulated empty curl -w '%{http_code}'
if [ $STATUS = 200 ]; then
  echo "healthy"
else
  echo "unhealthy"
fi

FILES="*.conf"
if [ $FILES = "*.conf" ]; then
  echo "no configs"
else
  echo "has configs: $FILES"
fi
```

## Expected Failure

```bash
bash check.sh
# check.sh: line 5: [: =: unary operator expected
# unhealthy
# has configs: app.conf  (or whatever *.conf expanded to)
```

Empty `$STATUS` became `[ = 200 ]` (one argument too few). Unquoted `$FILES`
glob-expanded inside `[ ]`, so the comparison was never to the literal `*.conf`.

## Expected Outcome

Empty status is unhealthy; a literal glob pattern is compared without expansion.

```bash
bash check.sh
# unhealthy
# no configs          # when no files match, with nullglob/quoted [[
```

No `unary operator expected`.

## Hints

### Hint 1 — Quote `[` arguments or use `[[`

`[ "$STATUS" = 200 ]` keeps empty as an empty argument. `[[ $STATUS == 200 ]]`
does not word-split or glob (on the right of `==` you can still glob-match
intentionally). Numeric: `-eq` / `(( STATUS == 200 ))`, not `=` .

### Hint 2 — [ is /bin/test

`==` is a bash `[` extension; POSIX `[` is `=`. `[[ && || ]]` is bash. If the
shebang is `#!/bin/sh`, use `[` + quotes + `=` / `-eq` only.

## Solution

Use `[[` in bash, or quote strictly.

```bash
#!/usr/bin/env bash
STATUS=""
if [[ "$STATUS" == "200" ]]; then
  echo "healthy"
else
  echo "unhealthy"
fi

if [[ ! -e *.conf ]]; then   # still careful: glob
  echo "no configs"
fi
# or:
shopt -s nullglob
configs=(*.conf)
if ((${#configs[@]} == 0)); then
  echo "no configs"
fi
```

- **`[` is not syntax; it is a command.** Missing quotes change the number of
  arguments and the error is `unary operator expected`.
- **`[[` is safer in bash** for strings; `((` for integers. Do not mix `-gt` with
  `[[ == ]]`.
- **Globs in tests** are a second classic: `[[ $f == *.txt ]]` is pattern match;
  `[[ $f == "*.txt" ]]` is literal.
- **Empty vs unset:** `set -u` + `[ $x = 1 ]` crashes; `"${x:-}"` or `[[`.
