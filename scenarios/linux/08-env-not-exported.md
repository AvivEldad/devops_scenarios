# The environment variable the child process cannot see

## Briefing

You set a variable in your shell, echo confirms it, but the program you launch behaves as
if it is unset. Or a script sets a variable and the command it calls does not receive it.

A shell variable is local to the shell until you `export` it. Only exported variables become
part of the environment that child processes inherit. Setting `VAR=value` without exporting
makes it visible to the current shell but not to anything it spawns.

## Your Task

- Set a variable, confirm the shell sees it, and show a child process does not.
- Explain the difference between a shell variable and an environment variable.
- Make the value reach the child, and understand per-command vs exported scope.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
cat > child.py <<'EOF'
import os
print("child sees API_TOKEN =", repr(os.environ.get("API_TOKEN")))
EOF
echo "run:  API_TOKEN=secret123   then:  python3 child.py"
```

## Expected Failure

```bash
bash setup.sh
API_TOKEN=secret123          # a SHELL variable, not exported
echo "shell sees: $API_TOKEN"
# shell sees: secret123        <- the current shell has it

python3 child.py
# child sees API_TOKEN = None   <- the child process does NOT
```

```bash
# proof: it is not in the environment passed to children
env | grep API_TOKEN || echo "not in environment"
# not in environment
```

`API_TOKEN=secret123` created a shell variable local to this shell. Because it was not
exported, it is not part of the environment, so `python3` (a child process) never receives
it.

## Expected Outcome

The child process receives the value.

Exported, it appears in the environment and the child sees it:

```bash
export API_TOKEN=secret123
env | grep API_TOKEN
# API_TOKEN=secret123

python3 child.py
# child sees API_TOKEN = 'secret123'
```

A per-command assignment also works, scoped to just that command:

```bash
API_TOKEN=secret123 python3 child.py
# child sees API_TOKEN = 'secret123'
# ...and it is NOT left set in the shell afterward:
echo "${API_TOKEN:-unset}"
# unset
```

## Hints

### Hint 1 — export turns a shell variable into an environment variable

`VAR=value` sets a shell variable, visible only to the current shell. `export VAR` (or
`export VAR=value`) adds it to the environment, which child processes inherit. Check the
process environment with `env` or `printenv VAR`; check shell variables with `set`. If `env`
does not list it, no child will see it.

### Hint 2 — Prefix a command to scope a variable to just that run

`VAR=value command` exports `VAR` for that single command only, without polluting the
shell. This is the clean way to pass a one-off setting (and to avoid leaving secrets set in
your interactive shell). For persistence across sessions, export in the appropriate startup
file; for services, use the unit's `Environment=`/`EnvironmentFile=`.

## Solution

The variable was set but not exported, so children did not inherit it. Export it (or scope
it per-command).

```bash
# make it inheritable by children
export API_TOKEN=secret123
python3 child.py            # child sees 'secret123'

# or scope to a single command (does not persist in the shell)
API_TOKEN=secret123 python3 child.py

# persist for future shells:  echo 'export API_TOKEN=...' >> ~/.profile   (avoid for secrets)
# for a systemd service:      Environment=API_TOKEN=...  or  EnvironmentFile=/etc/app.env
```

- **Shell variable vs environment variable.** `VAR=value` is shell-local; `export VAR` puts
  it in the environment that children inherit. `echo $VAR` works for both, which is why the
  distinction is easy to miss — use `env`/`printenv` to see only the exported set.
- **Children inherit the environment at spawn time.** Exporting after a process has started
  does not reach it; set and export before launching. Changing a running process's
  environment is not possible from the shell.
- **`VAR=value command` scopes to one command** — no leftover state, and the safest way to
  pass secrets without leaving them in your shell history/session.
- **Persist in the right place.** Login/interactive startup files for humans;
  `Environment=`/`EnvironmentFile=` for systemd services; explicit env in cron. Each
  execution context has its own environment source.
- **Avoid putting secrets in shell rc files.** They end up in backups and screen-shares;
  prefer a secrets manager, an `EnvironmentFile` with tight permissions, or per-command
  injection.
