# The reusable workflow could not see the input

## Briefing

`workflow_call` defines `inputs.region`. The caller passes `region: eu-west-1`
under `with:` but the called workflow still uses the default `us-east-1`, or
fails `Unexpected input(s) 'region'`. Inputs are not `env:`; they are
`inputs.*` and must be declared with `type:`. Secrets need `secrets: inherit`
or explicit `secrets:` mapping — they do not piggyback on `with:`.

Reusable workflows are functions with a schema. Typos fail closed or silently
default.

## Your Task

- Call a reusable workflow with `with:` keys that do not match `inputs:`.
- Declare `type: string` / `boolean` and pass from the caller.
- Pass a secret via `secrets:` not `with:`.

## Starter Files

### file: .github/workflows/reusable-deploy.yml

```yaml
name: reusable-deploy
on:
  workflow_call:
    inputs:
      environment:
        type: string
        required: true
    secrets:
      DEPLOY_KEY:
        required: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "env=${{ inputs.environment }}"
      - run: test -n "${{ secrets.DEPLOY_KEY }}"
```

### file: .github/workflows/prod.yml

```yaml
name: prod
on: workflow_dispatch
jobs:
  deploy:
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      region: eu-west-1          # not declared
      environment: production
    # secrets not passed
```

## Expected Failure

```text
Unexpected input(s) 'region', ...
# or: Input 'environment' ok but
# Secret DEPLOY_KEY is required but not provided
```

`inputs.region` in the callee would be empty even if you "passed" it under a
wrong name.

## Expected Outcome

Caller maps names exactly; secrets inherit or are listed.

```yaml
jobs:
  deploy:
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: production
    secrets:
      DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
# or: secrets: inherit
```

The step prints `env=production` and the secret is present.

## Hints

### Hint 1 — workflow_call schema is strict

Undeclared `with:` keys error. Missing `required` inputs error. Booleans must
be booleans (`true`, not `"true"` as a string unless type is string).

### Hint 2 — secrets: inherit

`inherit` passes all caller secrets to the callee. Explicit mapping is
least-privilege. Org secrets still need to be available to the caller repo.

## Solution

Align `with:` to `inputs:`; pass `secrets:`.

```yaml
# caller
with:
  environment: production
secrets: inherit
```

- **`uses: org/repo/.github/workflows/ci.yml@v1`** must pin a ref. `@main` is
  mutable — supply-chain cousin of actions tags.
- **Caller `permissions:`** must include what the callee needs; callee can
  only reduce.
- **Outputs** from reusable workflows: `jobs.x.outputs` +
  `on.workflow_call.outputs` mapping. Easy to forget the outer map.
- **Cannot nest `workflow_call` more than one level** (GitHub limit) — design
  for one hop.
