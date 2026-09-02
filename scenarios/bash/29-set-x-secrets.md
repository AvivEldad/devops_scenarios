# set -x printed the secret in CI

## Briefing

`set -x` / `bash -x` is the first debug tool. Combined with
`curl -u "$USER:$PASSWORD"` or `aws configure`, the trace line
`+ curl -u admin:s3cret` lands in Jenkins logs, GitHub Actions, and the
terminal you screen-shared. `PS4` can leak too. Expert bash is knowing how to
trace without tracing secrets.

`set +x` around sensitive lines, `BASH_XTRACEFD`, and never `echo $PASSWORD`
are the controls.

## Your Task

- Run a script with `set -x` and show the password in the trace.
- Silence tracing around the secret command.
- Redact `PS4` / avoid putting secrets on the command line at all (file /
  env fd).

## Starter Files

### file: login.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
set -x
PASSWORD=s3cret-token
curl -sS -u "admin:$PASSWORD" https://example.invalid/ || true
```

## Expected Failure

```bash
bash login.sh 2>&1 | grep -E 's3cret|PASSWORD'
# + PASSWORD=s3cret-token
# + curl ... admin:s3cret-token ...
```

Anyone with CI logs has the token. `set -x` expands arguments after assignment
trace too.

## Expected Outcome

The trace shows `curl` without the secret (or no trace during that line).

```bash
# + curl -sS -u admin:**** ...     (if you wrap)
# or no + curl line at all
```

`PASSWORD` is still passed to curl via an env var or a netrc file with mode
0600.

## Hints

### Hint 1 — set +x locally

```bash
set +x
curl -sS -u "admin:${PASSWORD}" "$url"
set -x
```

Traces `set +x` itself but not curl args. Better: do not put the secret in argv
— `curl --netrc-file` or `Authorization` header from a file.

### Hint 2 — xtrace fd and PS4

`export BASH_XTRACEFD=7` and send fd 7 to a secure log. `PS4='+ ${BASH_SOURCE}:${LINENO}: '`
helps debug without changing leak surface. `trap ... DEBUG` can filter but is
easy to get wrong.

## Solution

```bash
#!/usr/bin/env bash
set -euo pipefail
set -x
PASSWORD=s3cret-token
set +x
curl -sS -u "admin:${PASSWORD}" https://example.invalid/ || true
set -x
```

Better: `--netrc-file` / `CURL_HOME`. In GitHub Actions, `add-mask` the value
*before* any step that could print it; still do not `set -x` those steps.

- **CI `ACTIONS_STEP_DEBUG` / `bash -x` in `run:`** is a common leak. Disable
  for deploy jobs.
- **`echo $PASSWORD` in an `if`** still shows in xtrace as the test command.
- **`export` lines are traced.** `set +x` before `export SECRET=`.
- **Rotate anything that hit a log.** Treat xtrace leaks like git history
  leaks.
