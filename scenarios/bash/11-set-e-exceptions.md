# set -e did not stop the script

## Briefing

The script has `set -euo pipefail` and a command fails — then the script continues.
`set -e` is disabled in several contexts: the condition of `if`, `while`, `||`,
`&&` lists (except the last command in some cases), and commands in `$( )` in
some versions. People add `set -e` and believe they have crash-safety; they do
not.

This is the cousin of the pipefail scenario: the shell's "errexit" rules are
narrower than "any failure aborts".

## Your Task

- Run a script where a failing command is "checked" by `if` or `|| true` and
  execution continues.
- Show a failing command that is *not* in those contexts and does abort.
- Decide which failures must abort and handle them explicitly.

## Starter Files

### file: deploy.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

false
echo "unreachable if set -e always worked... but wait"

if curl -fsS https://example.invalid/health; then
  echo "healthy"
fi
echo "still running after failed curl in if"

curl -fsS https://example.invalid/health || true
echo "still running after || true"

# this one SHOULD abort (uncomment after you see the above):
# curl -fsS https://example.invalid/health
# echo "never"
```

## Expected Failure

```bash
bash deploy.sh
# unreachable if set -e always worked... but wait     <- wait, false DID abort?
```

Actually `false` as a simple command **does** abort with `set -e`. Remove it:

```bash
# after deleting the standalone false:
# still running after failed curl in if
# still running after || true
```

The dangerous part is believing the whole script is fail-fast when most real
checks are in `if` / `||`.

## Expected Outcome

You can name which lines abort and which do not. Real deploy steps that must
fail the job are not hidden in `if` without a branch that exits.

```bash
if ! curl -fsS "$URL/health"; then
  echo "health check failed" >&2
  exit 1
fi
```

Standalone `curl -fsS` with `set -e` also aborts — that is fine.

## Hints

### Hint 1 — POSIX errexit exceptions

Commands in `if CMD`, `while CMD`, `until CMD`, and `CMD || ...` / `CMD && ...`
(not the last in the `&&` chain in some shells) do not trigger `set -e`. `false`
alone does. `$(false)` behaviour varied by bash version (`inherit_errexit`).

### Hint 2 — Be explicit

Do not fight `set -e` with folklore. For critical steps: check `$?` yourself or
`cmd || exit`. Keep `set -e` as a backstop for forgotten lines, not the only
control flow.

## Solution

Treat `if cmd` as "I will handle this". Fail loud on the failure branch.

```bash
#!/usr/bin/env bash
set -euo pipefail

if ! curl -fsS https://example.invalid/health; then
  echo "health check failed" >&2
  exit 1
fi

curl -fsS "$URL/deploy"   # abort on failure (set -e)
```

- **`set -e` is a backstop, not a specification.** Read the bash manual "The
  shell does not exit if the command that fails is..." list.
- **`|| true` is a deliberate ignore.** Grep for it in review; it is how tests
  never fail (see Jenkins green-but-no-tests).
- **`pipefail` is still required** so `curl | jq` fails on curl. `set -e` without
  `pipefail` is the previous scenario.
- **Bash 4.4+ `inherit_errexit`** makes command substitution honour `set -e`
  more often — do not assume old bash.
