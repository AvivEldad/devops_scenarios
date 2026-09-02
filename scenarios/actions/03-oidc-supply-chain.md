# The deploy job that cannot get credentials

## Briefing

Your organisation is removing long-lived AWS access keys from CI. The replacement is
OIDC: the workflow presents a short-lived identity token to AWS, AWS validates it
against a trust policy, and hands back temporary credentials. No stored secret.

The migration has stalled. The deploy job fails at the credential step and the error
does not obviously say why:

```
Error: Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

The AWS side was set up by someone who followed a blog post. The workflow was written
by someone else following a different one. Neither is wrong on its own terms, and
together they do not work.

There are three faults in the identity chain and two supply-chain problems that a
security review would block separately.

> **You bring the AWS account.** This creates an OIDC identity provider, an IAM role
> and an S3 bucket. Cost is negligible. Run the teardown at the end and use a sandbox
> account, never production.

## Your Task

1. Set up the AWS side with the provided script and push the workflow.
2. Reproduce the `AssumeRoleWithWebIdentity` failure.
3. Fix the three faults preventing the role assumption. For each, say which side —
   GitHub or AWS — was misconfigured.
4. Fix the two supply-chain weaknesses in the workflow.
5. Prove the deploy works, that the credentials are short-lived, and that a workflow
   running on a different branch cannot assume the role.
6. Tear it down.

## Starter Files

### file: aws-setup.sh

```bash
#!/usr/bin/env bash
# Creates the OIDC provider, role and bucket. Faults are intentional.
set -euo pipefail

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGION="${AWS_REGION:-eu-west-1}"
BUCKET="breakfix-oidc-${ACCOUNT}"
ROLE="breakfix-gha-deploy"
REPO="${GH_REPO:?set GH_REPO to owner/repo}"

echo "account=$ACCOUNT repo=$REPO"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
fi

# the GitHub OIDC identity provider
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 2>/dev/null || \
  echo "provider already exists"

# FAULT: the trust policy restricts the subject to a branch that is not the one
# the workflow runs on, and uses StringEquals on a value that needs care
cat > trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:${REPO}:ref:refs/heads/master"
        }
      }
    }
  ]
}
EOF

aws iam create-role --role-name "$ROLE" \
  --assume-role-policy-document file://trust.json 2>/dev/null || \
aws iam update-assume-role-policy --role-name "$ROLE" \
  --policy-document file://trust.json

cat > role-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::${BUCKET}" },
    { "Effect": "Allow", "Action": ["s3:PutObject","s3:GetObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/*" }
  ]
}
EOF
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name breakfix-deploy-s3 --policy-document file://role-policy.json

cat > env.sh <<EOF
export ACCOUNT=$ACCOUNT
export REGION=$REGION
export BUCKET=$BUCKET
export ROLE=$ROLE
export ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$ROLE
EOF

echo "done. role arn: arn:aws:iam::$ACCOUNT:role/$ROLE"
```

### file: .github/workflows/deploy.yaml

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT_ID:role/breakfix-gha-deploy
          aws-region: eu-west-1

      - name: Build artifact
        uses: some-org/build-action@main

      - name: Upload
        run: |
          echo "build $GITHUB_SHA" > artifact.txt
          aws s3 cp artifact.txt "s3://breakfix-oidc-ACCOUNT_ID/releases/$GITHUB_SHA.txt"
```

### file: aws-teardown.sh

```bash
#!/usr/bin/env bash
set -uo pipefail
source ./env.sh

aws s3 rm "s3://$BUCKET" --recursive || true
aws s3api delete-bucket --bucket "$BUCKET" || true
aws iam delete-role-policy --role-name "$ROLE" --policy-name breakfix-deploy-s3 || true
aws iam delete-role --role-name "$ROLE" || true
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn \
  "arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com" || true
rm -f env.sh trust.json role-policy.json
echo "teardown complete"
```

## Expected Failure

```bash
export GH_REPO=YOUR-USER/YOUR-REPO
bash aws-setup.sh
source env.sh
# substitute your account id into the workflow, commit and push
```

The job fails at the credentials step:

```
Run aws-actions/configure-aws-credentials@v4
Error: Could not load credentials from any providers
Error: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

Depending on which fault you hit first you may instead see:

```
Error: Credentials could not be loaded, please check your action inputs:
OIDC token could not be retrieved: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable
```

That second message is the more informative one, and it points at the GitHub side
rather than AWS.

## Expected Outcome

The deploy succeeds using temporary credentials with no stored secret.

The job assumes the role and reports a session identity:

```bash
gh run view --log | grep -A2 'aws sts get-caller-identity'
# "Arn": "arn:aws:sts::123456789012:assumed-role/breakfix-gha-deploy/GitHubActions"
```

Add a verification step and confirm the identity is an **assumed role session**, not a
user:

```yaml
- run: aws sts get-caller-identity
```

The artefact reaches the bucket:

```bash
source env.sh
aws s3 ls "s3://$BUCKET/releases/"
# 2026-08-31 12:00:00   45 <commit-sha>.txt
```

There is no long-lived credential anywhere:

```bash
gh secret list
# no AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

The credentials are short-lived. Confirm the session duration is bounded:

```bash
aws iam get-role --role-name "$ROLE" --query 'Role.MaxSessionDuration'
# 3600 or less
```

**A different branch cannot assume the role.** This is the security property that
makes OIDC worth doing — verify it rather than assuming it:

```bash
git checkout -b sneaky
# add a workflow_dispatch trigger so it runs on this branch, push, run it
gh run list --limit 1
# the credentials step FAILS on the non-main branch
```

**Every third-party action is pinned to a commit SHA:**

```bash
grep -E 'uses:' .github/workflows/deploy.yaml
# every non-local action ends with @<40-char-sha>
# no @main, no @master, no bare @v4 for untrusted publishers
```

**The token permission is explicit and minimal:**

```bash
grep -A3 'permissions:' .github/workflows/deploy.yaml
# id-token: write
# contents: read
```

Then tear down:

```bash
bash aws-teardown.sh
```

## Hints

### Hint 1 — The workflow cannot request a token at all

```
Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable
```

Requesting an OIDC token requires an explicit permission. Without it, GitHub does not
inject the token endpoint into the job environment, and the action has nothing to
present to AWS.

```yaml
permissions:
  id-token: write
  contents: read
```

`id-token: write` is the permission to *mint* an identity token — it grants nothing in
AWS. Note that declaring any `permissions` block resets all others to none, so include
`contents: read` for the checkout.

### Hint 2 — Read the `sub` claim and compare it character by character

The trust policy matches on the token's subject claim:

```
"token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:ref:refs/heads/master"
```

Your workflow runs on `main`. The claim GitHub actually sends will be
`repo:OWNER/REPO:ref:refs/heads/main`, and `StringEquals` means exactly that string.

Other shapes you will meet, worth recognising:

| Trigger | `sub` claim |
|---|---|
| push to a branch | `repo:OWNER/REPO:ref:refs/heads/main` |
| a tag | `repo:OWNER/REPO:ref:refs/tags/v1.2.3` |
| a pull request | `repo:OWNER/REPO:pull_request` |
| a GitHub environment | `repo:OWNER/REPO:environment:production` |

To allow several branches, use `StringLike` with a wildcard —
`repo:OWNER/REPO:ref:refs/heads/*` — but understand that this permits **every** branch,
including one an attacker with write access creates. Environments are usually the
better boundary for production.

### Hint 3 — Print the claims instead of guessing

You can fetch and decode the token in a scratch workflow to see exactly what AWS will
receive:

```yaml
- name: Show OIDC claims
  run: |
    TOKEN=$(curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
      "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r .value)
    echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

Do this on a throwaway branch and remove it afterwards — the token is a credential.
Comparing the printed `sub` and `aud` against your trust policy turns this from
guesswork into a two-second diff.

### Hint 4 — The workflow references a placeholder account

`arn:aws:iam::ACCOUNT_ID:role/breakfix-gha-deploy` is literally the string
`ACCOUNT_ID`. Substitute the real value, or better, keep it out of the file:

```yaml
role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
```

An account ID is not secret, but a repository variable or secret keeps the workflow
portable across environments. Note the bucket name in the upload step has the same
placeholder.

### Hint 5 — `uses: some-org/build-action@main` is the supply-chain problem

A mutable ref means you execute whatever that repository contains at the moment your
job runs. The author — or anyone who compromises their account — can change it after
your review, and your job runs it with `id-token: write` in scope.

Pin third-party actions to a full commit SHA:

```yaml
- uses: some-org/build-action@8f4b7c2e5a1d9f3b6c0e2a4d8f1b3c5e7a9d0f2b  # v2.1.0
```

A tag can be moved; a SHA cannot. Dependabot understands SHA pins and will open PRs to
update them with the version in the comment.

`actions/checkout@v4` and other first-party `actions/*` are widely treated as
acceptable at a major tag, since GitHub controls the namespace. Everything else should
be pinned.

## Solution

Three identity-chain faults and two supply-chain weaknesses.

**Fault 1 (GitHub side)** — no `id-token: write` permission, so no token was ever
requested.

**Fault 2 (AWS side)** — the trust policy's `sub` condition names `refs/heads/master`
while the workflow runs on `main`.

**Fault 3 (workflow)** — the role ARN and bucket name are unsubstituted placeholders.

**Weakness 4** — a third-party action pinned to a mutable branch.

**Weakness 5** — no explicit permissions, no session name, unbounded session.

### The corrected trust policy

```bash
source env.sh
cat > trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:${GH_REPO}:ref:refs/heads/main"
        }
      }
    }
  ]
}
EOF

aws iam update-assume-role-policy --role-name "$ROLE" --policy-document file://trust.json
aws iam update-role --role-name "$ROLE" --max-session-duration 3600
```

### The corrected workflow

```yaml
name: Deploy

on:
  push:
    branches: [main]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

# minimum required: mint an OIDC token, read the repository
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment: production

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
          role-session-name: gha-${{ github.run_id }}-${{ github.run_attempt }}
          aws-region: ${{ vars.AWS_REGION }}

      - name: Verify identity
        run: aws sts get-caller-identity

      - name: Build artifact
        uses: some-org/build-action@8f4b7c2e5a1d9f3b6c0e2a4d8f1b3c5e7a9d0f2b # v2.1.0

      - name: Upload
        env:
          BUCKET: ${{ vars.AWS_DEPLOY_BUCKET }}
        run: |
          set -euo pipefail
          echo "build $GITHUB_SHA" > artifact.txt
          aws s3 cp artifact.txt "s3://${BUCKET}/releases/${GITHUB_SHA}.txt"
```

Set the repository variables:

```bash
gh variable set AWS_DEPLOY_ROLE_ARN --body "$ROLE_ARN"
gh variable set AWS_DEPLOY_BUCKET   --body "$BUCKET"
gh variable set AWS_REGION          --body "$REGION"
```

How the OIDC exchange actually works, which is what makes the failures readable:

```
1. The job asks GitHub's token service for a signed JWT, using the
   permission granted by id-token: write.
2. The JWT contains claims: iss (GitHub), aud (sts.amazonaws.com),
   sub (repo:owner/repo:ref:refs/heads/main), plus repository, actor, and more.
3. The action calls sts:AssumeRoleWithWebIdentity, presenting the JWT.
4. AWS verifies the signature against the registered OIDC provider,
   then evaluates the role's trust policy conditions against the claims.
5. On success, STS returns temporary credentials valid for the session duration.
```

Every failure maps to a step: no token means step 1 (permissions); a signature or
provider error means step 4's provider registration; `Not authorized` means step 4's
condition matching, and the `sub` claim is almost always the culprit.

Why this is worth the migration effort: there is no credential to store, so none to
leak, rotate, or find in a git history years later. The credential AWS issues is
valid for minutes and is bound to a specific repository and branch. A stolen workflow
log contains nothing reusable.

Two hardening notes for production use:

- **Use environments as the boundary for production.** With
  `sub: repo:OWNER/REPO:environment:production` in the trust policy plus required
  reviewers on the environment, deploying requires human approval that a branch-based
  condition cannot express.
- **Never condition only on `aud`.** A trust policy that checks the audience but not
  the subject will accept a token from *any* GitHub repository. That is a
  catastrophic and surprisingly common misconfiguration.

**Teardown:**

```bash
bash aws-teardown.sh
```

## What You Learned

The error said `Not authorized to perform sts:AssumeRoleWithWebIdentity`, which sounds
like an IAM permissions problem and is actually a claims-matching problem — and in one
variant, the token was never even requested, which is a GitHub-side problem with an
AWS-shaped error message. Splitting the diagnosis by which system owns each step of
the exchange is what makes it tractable.

The broader shift is worth internalising beyond this scenario: OIDC replaces "a secret
both sides know" with "a signed assertion one side makes and the other verifies". That
means debugging moves from "is the secret correct" to "do the claims match the policy",
and the way to answer it is to print the claims. Meanwhile, the supply-chain fixes here
are not incidental to that — a job with `id-token: write` can mint your cloud identity,
so every unpinned third-party action in it is a path to your infrastructure.
