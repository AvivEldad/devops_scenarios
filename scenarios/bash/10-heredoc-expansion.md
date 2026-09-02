# The heredoc that leaked the password and broke the script

## Briefing

A deploy script writes a systemd unit or a Python file with a heredoc. `$HOME` and
`$(hostname)` expanded when you wanted literals. Or you quoted the delimiter
(`<<'EOF'`) and now `$APP_VERSION` did **not** expand when you needed it. A
password in the same unquoted heredoc landed in the process list via `echo`.

Unquoted `<<EOF` expands parameters, command substitution, and arithmetic. Quoted
`<<'EOF'` does not. `<<-EOF` strips leading tabs only.

## Your Task

- Write a heredoc that accidentally expands `$HOME` / backticks.
- Write one that fails to expand a version you needed.
- Produce a file with mixed: expand some variables, not others.

## Starter Files

### file: write-unit.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
PASSWORD=s3cret
APP_VERSION=1.4.2
cat > /tmp/app.service <<EOF
[Service]
Environment=HOME=$HOME
Environment=PASSWORD=$PASSWORD
ExecStart=/usr/bin/app --home \$HOME
# the next line was supposed to be literal help text:
# See $HOME/docs
EOF
cat /tmp/app.service
```

## Expected Failure

```bash
bash write-unit.sh
# [Service]
# Environment=HOME=/home/you          <- expanded
# Environment=PASSWORD=s3cret         <- secret in the file (maybe intended)
# ExecStart=... --home $HOME          <- \$ worked
# See /home/you/docs                  <- comment expanded too
```

The unit now hard-codes your laptop `$HOME` and a password. On the server the
service is wrong. The password is in the file and in shell history.

## Expected Outcome

You control which expansions happen.

Literal file (no expansion):

```bash
cat > /tmp/app.service <<'EOF'
Environment=HOME=$HOME
EOF
grep 'HOME=\$HOME\|HOME=$HOME' /tmp/app.service
```

Mixed: version expands, `$HOME` does not:

```bash
cat > /tmp/x <<EOF
version=${APP_VERSION}
home=\$HOME
EOF
```

## Hints

### Hint 1 — Quote the delimiter to disable expansion

`<<'EOF'` / `<<"EOF"` — the quotes are around the tag, not the body. Body is
literal. Unquoted `<<EOF` is like a double-quoted string spanning lines.

### Hint 2 — Escape one dollar

In an expanding heredoc, `\$HOME` and `\\` rules apply. `${APP_VERSION}` expands.
Do not put secrets in expanding heredocs that get `set -x` logged; `set +x` around
them or use a file descriptor.

## Solution

Quote when you mean literal; unquote only for known interpolations.

```bash
APP_VERSION=1.4.2
cat > /tmp/app.service <<EOF
[Service]
Environment=APP_VERSION=${APP_VERSION}
ExecStart=/usr/bin/app --home \$HOME
EOF
```

Fully literal:

```bash
cat > /tmp/snippet.py <<'PY'
print("$HOME is not expanded")
PY
```

- **Heredocs are not "just files".** They are quoted or not, like strings.
- **`<<-`** only strips **tabs** before the body and the closing tag — spaces
  stay. Mixing tabs and spaces makes "why is EOF not found?" errors.
- **`<<EOF` without a line that is exactly `EOF`** (spaces, CRLF) hangs the
  script waiting for more input — or eats the rest of the file.
- **Secrets:** prefer `EnvironmentFile=` with mode 0600 over embedding passwords
  in a script that is world-readable in git.
