# The PR title became a bash command

## Briefing

A step does:

```yaml
run: echo "${{ github.event.pull_request.title }}"
```

A PR titled `$(id)` or `` `curl attacker` `` or `"; curl ... #` runs in bash
because `${{ }}` is interpolated **before** the script is passed to the
shell. This is expression injection. The fix is to pass the value through
`env:` and use `"$TITLE"` in the script — env is data, `${{ }}` in `run:` is
code.

Never put untrusted event fields in `run:` strings.

## Your Task

- Find `${{ github.event.* }}` inside `run:`.
- Move it to `env:` and quote the shell variable.
- List other dangerous fields (`issue.body`, `head.ref`, `commit.message`).

## Starter Files

### file: .github/workflows/greet.yml

```yaml
name: greet
on: pull_request
jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - run: echo "PR: ${{ github.event.pull_request.title }}"
      - run: git checkout ${{ github.head_ref }}
```

## Expected Failure

```text
PR title: $(touch /tmp/pwned)
The runner executes touch as part of the generated script.
head_ref: '; echo pwned #'  breaks git checkout
```

The workflow file looks like a simple echo. The attacker controls the
interpolated bytes.

## Expected Outcome

Untrusted strings only appear as environment values.

```yaml
- env:
    TITLE: ${{ github.event.pull_request.title }}
    REF: ${{ github.head_ref }}
  run: |
    echo "PR: $TITLE"
    git checkout -- "$REF"
```

A malicious title prints literally; it is not executed.

## Hints

### Hint 1 — Interpolation is YAML-time

The shell never sees `${{ }}`. It sees the expanded script. `env:` values are
still interpolated into the **job env**, but they are not parsed as shell
syntax when you use `"$TITLE"`.

### Hint 2 — `toJSON` in run is still interpolation

`run: echo '${{ toJSON(github.event.issue.body) }}'` is quoted YAML, not
safe if the body contains `'`. Use env + `python -c` reading os.environ.

## Solution

```yaml
- name: show title
  env:
    TITLE: ${{ github.event.pull_request.title }}
  run: printf '%s\n' "$TITLE"
```

- **`pull_request_target` + this pattern** is critical (secrets + injection).
- **`github.event.client_payload`** from `repository_dispatch` is untrusted
  too.
- **Actions that take `github.event` in `with:`** may still interpolate
  unsafely inside the action — prefer well-maintained actions.
- **CodeQL / `actions/github-script`** with `github.event` in a template
  string has the same class of bug in JS (`eval`-like).
