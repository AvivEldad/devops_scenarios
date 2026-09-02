# secrets.* is empty in env: but I set the secret

## Briefing

You wrote:

```yaml
env:
  API_KEY: ${{ secrets.API_KEY }}
```

and `echo $API_KEY` is empty, or you used `${{ env.API_KEY }}` in a context
where env is not populated yet. Or you referenced `secrets.api_key` (wrong
case — secrets are case-sensitive). Or the secret exists on the org but not
for this environment. Fork PRs are already covered in actions-02; this drill
is **name, case, environment, and env vs secrets contexts**.

## Your Task

- Find why `secrets.API_KEY` is empty (name/case/environment/wrong context).
- Map secrets only in `env:` of the step that needs them.
- Fail the job if a required secret is missing (`if: ${{ secrets.API_KEY == '' }}`
  does not work — secrets are masked/empty in `if` for untrusted events; use a
  dummy check in a trusted workflow).

## Starter Files

### file: .github/workflows/deploy.yml

```yaml
name: deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      API_KEY: ${{ secrets.api_key }}   # secret is named API_KEY
    steps:
      - run: echo "key len=${#API_KEY}"
      - run: echo "from context ${{ env.API_KEY }}"
```

## Expected Failure

```text
key len=0
from context                 # empty
```

Repo secret is `API_KEY`. Expression used `secrets.api_key`. Empty string.
No error.

## Expected Outcome

The step receives the secret as an environment variable; logs show only
`***` if printed (do not print it).

```yaml
env:
  API_KEY: ${{ secrets.API_KEY }}
```

```bash
# key len=32   (not shown in real logs if you echo the value — GitHub masks it)
```

## Hints

### Hint 1 — Exact name

Settings → Secrets and variables → Actions. Names are case-sensitive.
`secrets.API_KEY` vs `secrets.APIKEY`. Environment secrets only apply when
`jobs.x.environment: prod`.

### Hint 2 — Context availability

`secrets` is not available in `run` *script* except via `env` mapping (you
cannot `${{ secrets.X }}` inside a file you write without it becoming part of
the workflow YAML). `env` context is populated from `env:` keys. Nested
`env:` on a step overrides job `env:`.

## Solution

Match the name; attach Environment if used; map into `env:`.

```yaml
jobs:
  deploy:
    environment: production
    env:
      API_KEY: ${{ secrets.API_KEY }}
    steps:
      - run: test -n "$API_KEY"
      - run: ./deploy
```

- **Empty secrets fail open** unless you `test -n`. Add that check in trusted
  workflows.
- **Variables (`vars.*`) are not secrets.** They show in logs. Do not store
  tokens there.
- **Organization secrets** need repository access granted.
- **Never `${{ secrets.X }}` in `run: echo`** — use env and still avoid
  echoing. Masking is not perfect (`set -x`).
