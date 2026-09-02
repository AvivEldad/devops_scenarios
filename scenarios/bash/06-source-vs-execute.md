# The env file I ran did nothing

## Briefing

You have `env.sh` that sets `export REGION=eu-west-1`. You run `./env.sh` (or
`bash env.sh`) then `echo $REGION` and it is empty. A teammate says "just source
it". The script ran in a **child shell**; its `export` died with that process.

This is the same class of bug as `cd` in a script not changing your prompt: child
vs current shell.

## Your Task

- Run the env file as a program and show the parent shell is unchanged.
- `source` / `.` it and show the variables appear.
- Make the file refuse to be executed if that would be misleading (optional guard).

## Starter Files

### file: env.sh

```bash
#!/usr/bin/env bash
export REGION=eu-west-1
export APP_ENV=staging
echo "env.sh set REGION=$REGION (this shell only)"
```

### file: notes.md

```text
Run from your interactive shell:
  chmod +x env.sh
  ./env.sh
  echo "parent REGION=${REGION:-empty}"
```

## Expected Failure

```bash
chmod +x env.sh
./env.sh
# env.sh set REGION=eu-west-1 (this shell only)
echo "parent REGION=${REGION:-empty}"
# parent REGION=empty
```

The child printed the right value. The parent never received `export`.

## Expected Outcome

After sourcing, the current shell has the variables.

```bash
source env.sh
# or:  . ./env.sh
echo "$REGION"
# eu-west-1
```

`./env.sh` is documented as the wrong invocation (or the script detects it).

## Hints

### Hint 1 — source runs in this shell

`. file` and `source file` read commands into the current process. Executing a
file (`./file`, `bash file`) is always a child unless you `exec`. Aliases and
`cd` have the same rule.

### Hint 2 — Detect being sourced

`[[ ${BASH_SOURCE[0]} != "$0" ]]` is true when sourced. You can warn: `if [[
${BASH_SOURCE[0]} == "$0" ]]; then echo "source this file"; exit 1; fi`.

## Solution

Source it; optionally guard against execute.

```bash
source ./env.sh
echo "$REGION"
```

```bash
# guard at top of env.sh
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  echo "usage: source $0" >&2
  exit 1
fi
```

- **Every process has its own environment.** Children inherit a copy; they cannot
  write back (except via tricks: eval, nameref in the same bash, files).
- **Dotfiles are sourced** by the shell; that is why `export` in `~/.bashrc`
  works interactively and not in cron (cron does not source bashrc).
- **`#!/usr/bin/env bash` on a file meant to be sourced** is optional; the caller
  must still `.` it. Shebang only runs on execute.
- **`set -a; source .env; set +a`** auto-exports every variable in a dotenv-style
  file — still must be sourced.
