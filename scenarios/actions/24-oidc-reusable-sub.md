# OIDC worked in CI.yml and failed in the reusable workflow

## Briefing

`aws-actions/configure-aws-credentials` + `id-token: write` works in a
top-level job. The same steps in a `workflow_call` callee get
`Not authorized to perform sts:AssumeRoleWithWebIdentity`. The trust policy
`sub` is `repo:ORG/REPO:ref:refs/heads/main` but reusable workflows set
`job_workflow_ref` to the **callee** file. The claim in the token no longer
matches.

This extends actions-03: same OIDC family, reusable-workflow `sub` gotcha.

## Your Task

- Compare `sub` for a normal job vs a reusable workflow job.
- Update the IAM trust policy (or `condition`) to allow
  `job_workflow_ref`.
- Keep `id-token: write` on the **callee** job that calls AWS.

## Starter Files

### file: trust-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:myorg/app:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

### file: .github/workflows/deploy.yml

```yaml
on: workflow_call
jobs:
  aws:
    permissions:
      id-token: write
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/ci
          aws-region: eu-west-1
```

## Expected Failure

```text
Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

Token `sub` looks like
`repo:myorg/app:job_workflow_ref:myorg/app/.github/workflows/deploy.yml@refs/heads/main`
not `repo:myorg/app:ref:refs/heads/main`.

## Expected Outcome

Trust policy matches reusable workflow subjects (or uses `StringLike` on
`repo:myorg/app:*` **narrowly** — prefer explicit `job_workflow_ref`).

```json
"token.actions.githubusercontent.com:sub":
  "repo:myorg/app:job_workflow_ref:myorg/app/.github/workflows/deploy.yml@refs/heads/main"
```

AssumeRole succeeds; `aws sts get-caller-identity` shows the role.

## Hints

### Hint 1 — Log the token claims

GitHub documents `sub` formats. Temporarily run a step that prints
`ACTIONS_ID_TOKEN_REQUEST_URL` is not the claims — decode is easier via
AWS CloudTrail error or a trusted debug action. Do not paste live tokens.

### Hint 2 — permissions on the callee

`id-token: write` must be on the job that requests the token. Caller
`permissions` must allow the callee to request it (caller can only grant
what it has).

## Solution

Widen the trust `sub` to the reusable workflow ref; pin to `@refs/heads/main`
or a tag, not `@*`.

```json
"StringLike": {
  "token.actions.githubusercontent.com:sub":
    "repo:myorg/app:job_workflow_ref:myorg/app/.github/workflows/deploy.yml@*"
}
```

Prefer exact ref over `*`.

- **`environment` in sub** (`repo:...:environment:prod`) is another mismatch
  when you add `environment:` later.
- **Account ID `123456789012` in examples** must be yours — placeholder is a
  classic actions-03 miss.
- **Multiple repos calling one reusable workflow** in a shared `.github` repo
  change `sub` to that org/repo — trust each caller or the callee repo.
- **Do not use `aud` only** without `sub`; that trusts every GitHub repo in
  the world that can request the audience.
