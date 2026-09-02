# eval constructed a command from untrusted input

## Briefing

A wrapper does `eval "docker run $FLAGS $IMAGE"` or `eval "$user_expr"` to
support "any extra args". A flag of `$(touch pwned)` or `; rm -rf` runs. This is
the shell equivalent of SQL injection. The fix is arrays (`cmd+=("$flag")`) and
never `eval` / `bash -c "$var"` on untrusted strings.

You will also see `eval "$(ssh-agent)"` which is a *trusted* protocol — do not
confuse the two.

## Your Task

- Run a naive `eval` with a crafted FLAGS value and show extra commands execute.
- Rebuild the same docker/cli invocation with an array and `"${cmd[@]}"`.
- List the remaining `eval` cases that are acceptable (ssh-agent, direnv).

## Starter Files

### file: run.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
IMAGE=alpine
FLAGS=${1:-}
eval "echo docker run $FLAGS $IMAGE"
```

## Expected Failure

```bash
bash run.sh '$(echo PWNED >&2) -t'
# PWNED
# docker run  -t alpine
```

Or:

```bash
bash run.sh '; echo injected'
# docker run
# injected
# alpine     (depending on how eval parsed it)
```

The extra command ran in the shell of `run.sh`.

## Expected Outcome

Flags are passed as data to the child, not parsed as shell.

```bash
cmd=(echo docker run)
if [[ -n ${1:-} ]]; then
  cmd+=("$1")
fi
cmd+=("$IMAGE")
"${cmd[@]}"
# docker run $(echo PWNED) alpine     # literal argument, no pwn
```

## Hints

### Hint 1 — Arrays are argv

`"$@"` and `"${cmd[@]}"` become exec-style argv. No second parse. `eval` is a
second parse. `bash -c "$FLAGS"` is the same class.

### Hint 2 — printf %q is for humans, not a sandbox

`printf '%q' "$user"` quotes for bash, but if you then `eval` the result you
are back to eval. Use it for logging. For execution, keep arrays.

## Solution

```bash
#!/usr/bin/env bash
set -euo pipefail
IMAGE=alpine
cmd=(docker run)
# only allow literal extra args from a known list, or:
while (($#)); do cmd+=("$1"); shift; done
cmd+=("$IMAGE")
"${cmd[@]}"
```

- **`eval "$(ssh-agent -s)"`** is a documented, trusted generator. User CLI
  flags are not.
- **`xargs` / `find -exec`** also skip the shell if you do not wrap in `sh -c`.
  `find -exec sh -c '...' _ {} \;` reopens injection if `{}` is inside the
  string wrong — put `{}` as an arg.
- **`alias` and `functions` exported via `BASH_FUNC_`** are another injection
  surface in sudo/env -i discussions.
- **ShellCheck SC2086 / SC2294** exist for this. Treat eval as a review blocker.
