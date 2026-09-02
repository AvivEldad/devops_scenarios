# CI cannot assume the deploy role

## Briefing

The deployment pipeline is meant to assume a role called `breakfix-deploy-role` and
push artefacts to S3. It fails before it gets anywhere near S3:

```
An error occurred (AccessDenied) when calling the AssumeRole operation:
User: arn:aws:iam::123456789012:user/breakfix-ci is not authorized to perform:
sts:AssumeRole on resource: arn:aws:iam::123456789012:role/breakfix-deploy-role
```

The role has exactly the S3 permissions it needs. Someone has already checked that
three times, and they are right — and it is irrelevant, because what the role can do
has nothing to do with who is allowed to become it.

Assuming a role requires **two** policies to agree, and there are three faults spread
across them.

> **You bring the AWS account.** This creates an IAM user, a role, policies, an access
> key and a bucket. Cost is negligible. **Run the teardown when finished**, and use a
> sandbox account.

## Your Task

1. Run the setup and reproduce the `AssumeRole` failure.
2. Work out which side of the trust relationship is refusing, and why.
3. Fix all three faults so the CI user can assume the role and write to the bucket.
4. Confirm the CI user still cannot write to the bucket **directly** — only through
   the role.
5. Tear it down.

```bash
mkdir -p ~/breakfix/aws-03 && cd ~/breakfix/aws-03
aws sts get-caller-identity
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Creates a CI user and a deploy role with three deliberate faults.
set -euo pipefail

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGION="${AWS_REGION:-eu-west-1}"
BUCKET="breakfix-lab-${ACCOUNT}-deploy"
USER="breakfix-ci"
ROLE="breakfix-deploy-role"

echo "account=$ACCOUNT bucket=$BUCKET"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
fi

# ---- the CI user ----
aws iam create-user --user-name "$USER" 2>/dev/null || true

# FAULT 1: the user's policy allows S3, but never sts:AssumeRole
cat > user-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOwnIdentity",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity", "iam:ListRoles"],
      "Resource": "*"
    }
  ]
}
EOF
aws iam put-user-policy --user-name "$USER" \
  --policy-name breakfix-ci-policy --policy-document file://user-policy.json

# ---- the deploy role ----
# FAULT 2: the trust policy trusts an EC2 service principal, not the CI user
cat > trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "sts:ExternalId": "breakfix-2024" }
      }
    }
  ]
}
EOF

aws iam create-role --role-name "$ROLE" \
  --assume-role-policy-document file://trust-policy.json 2>/dev/null || \
aws iam update-assume-role-policy --role-name "$ROLE" \
  --policy-document file://trust-policy.json

# the role's own permissions are correct
cat > role-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::$BUCKET"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::$BUCKET/*"
    }
  ]
}
EOF
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name breakfix-deploy-s3 --policy-document file://role-policy.json

aws iam create-access-key --user-name "$USER" --output json > key.json

cat > use-ci-profile.sh <<'EOF'
export AWS_ACCESS_KEY_ID="$(python3 -c 'import json;print(json.load(open("key.json"))["AccessKey"]["AccessKeyId"])')"
export AWS_SECRET_ACCESS_KEY="$(python3 -c 'import json;print(json.load(open("key.json"))["AccessKey"]["SecretAccessKey"])')"
unset AWS_SESSION_TOKEN
echo "acting as: $(aws sts get-caller-identity --query Arn --output text)"
EOF

cat > env.sh <<EOF
export ACCOUNT=$ACCOUNT
export REGION=$REGION
export BUCKET=$BUCKET
export USER_NAME=$USER
export ROLE=$ROLE
export ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$ROLE
EOF

echo "setup complete; source env.sh"
```

### file: ci-deploy.sh

```bash
#!/usr/bin/env bash
# What the pipeline runs. FAULT 3 is in here.
set -euo pipefail
source ./env.sh

echo "assuming $ROLE_ARN"

CREDS=$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name ci-deploy \
  --query Credentials --output json)

export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["AccessKeyId"])')
export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["SecretAccessKey"])')
export AWS_SESSION_TOKEN=$(echo "$CREDS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["SessionToken"])')

echo "now acting as: $(aws sts get-caller-identity --query Arn --output text)"

echo "artifact $(date -Is)" > /tmp/deploy-artifact.txt
aws s3 cp /tmp/deploy-artifact.txt "s3://$BUCKET/releases/artifact.txt"
aws s3 ls "s3://$BUCKET/releases/"

echo "deploy complete"
```

### file: teardown.sh

```bash
#!/usr/bin/env bash
set -uo pipefail
source ./env.sh

aws s3 rm "s3://$BUCKET" --recursive || true
aws s3api delete-bucket --bucket "$BUCKET" || true

aws iam delete-role-policy --role-name "$ROLE" --policy-name breakfix-deploy-s3 || true
aws iam delete-role --role-name "$ROLE" || true

aws iam delete-user-policy --user-name "$USER_NAME" --policy-name breakfix-ci-policy || true
for k in $(aws iam list-access-keys --user-name "$USER_NAME" \
             --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
  aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$k"
done
aws iam delete-user --user-name "$USER_NAME" || true

rm -f key.json env.sh use-ci-profile.sh *-policy.json
echo "teardown complete"
```

## Expected Failure

```bash
bash setup.sh
source env.sh
sleep 15
source use-ci-profile.sh      # become the CI user
bash ci-deploy.sh
```

```
assuming arn:aws:iam::123456789012:role/breakfix-deploy-role

An error occurred (AccessDenied) when calling the AssumeRole operation:
User: arn:aws:iam::123456789012:user/breakfix-ci is not authorized to perform:
sts:AssumeRole on resource: arn:aws:iam::123456789012:role/breakfix-deploy-role
```

Confirm the role's permissions really are fine, so you can stop looking there:

```bash
# from your admin shell
aws iam get-role-policy --role-name breakfix-deploy-role --policy-name breakfix-deploy-s3
```

The S3 grants are correct. They are also completely irrelevant to this error, which
is thrown by STS before the role's permissions are ever consulted.

## Expected Outcome

The pipeline assumes the role and deploys, and the user has no direct access.

The full pipeline succeeds:

```bash
source use-ci-profile.sh
bash ci-deploy.sh
```

```
assuming arn:aws:iam::...:role/breakfix-deploy-role
now acting as: arn:aws:sts::...:assumed-role/breakfix-deploy-role/ci-deploy
2026-08-31 10:00:00         31 artifact.txt
deploy complete
```

Note the identity changes from `user/breakfix-ci` to `assumed-role/...` — that is the
proof the role was actually assumed rather than the user acting directly.

The object is in the bucket:

```bash
aws s3 ls "s3://$BUCKET/releases/"
# artifact.txt
```

The CI user **cannot** reach the bucket without the role. This check is required:

```bash
source use-ci-profile.sh          # plain user credentials, no session token
aws s3 cp /tmp/deploy-artifact.txt "s3://$BUCKET/direct.txt"
# AccessDenied      <- this failure is REQUIRED
```

The user's policy grants `sts:AssumeRole` on that one role, not on `*`:

```bash
aws iam get-user-policy --user-name breakfix-ci --policy-name breakfix-ci-policy \
  --output json | grep -A3 AssumeRole
# Resource must be the specific role ARN
```

The trust policy names the user, and the external ID condition is satisfied:

```bash
aws iam get-role --role-name breakfix-deploy-role \
  --query 'Role.AssumeRolePolicyDocument' --output json
```

The simulator confirms it:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn "arn:aws:iam::${ACCOUNT}:user/breakfix-ci" \
  --action-names sts:AssumeRole \
  --resource-arns "$ROLE_ARN" \
  --query 'EvaluationResults[].EvalDecision' --output text
# allowed
```

Then clean up:

```bash
bash teardown.sh
```

## Hints

### Hint 1 — Two policies must both say yes

Assuming a role is the one IAM operation that requires agreement from both sides:

| Policy | Lives on | Must allow |
|---|---|---|
| Identity policy | the **user** | `sts:AssumeRole` on the role's ARN |
| Trust policy | the **role** | the user as a `Principal` for `sts:AssumeRole` |

The trust policy is a *resource-based* policy, and it is the role's answer to "who is
allowed to become me". The role's permission policy — what the role can do once
assumed — plays no part in this decision at all.

Read the error message again: it names `sts:AssumeRole`, not `s3:PutObject`. The
failure is at the door, not inside the room.

### Hint 2 — Look at the trust policy's principal

```bash
aws iam get-role --role-name breakfix-deploy-role \
  --query 'Role.AssumeRolePolicyDocument'
```

The principal is `{"Service": "ec2.amazonaws.com"}`, which permits the EC2 service to
assume the role for instance profiles. An IAM user is not the EC2 service.

For a user you need an AWS principal:

```json
"Principal": { "AWS": "arn:aws:iam::ACCOUNT:user/breakfix-ci" }
```

Naming the specific user is better than `"AWS": "arn:aws:iam::ACCOUNT:root"`, which
delegates the decision to every identity policy in the account.

### Hint 3 — The user policy grants no STS action at all

```bash
aws iam get-user-policy --user-name breakfix-ci --policy-name breakfix-ci-policy
```

It allows `sts:GetCallerIdentity` and `iam:ListRoles`. Nothing grants
`sts:AssumeRole`, so even a perfect trust policy would not help — hence the error
naming the *user* as unauthorised.

Scope the grant to the one role. `"Resource": "*"` here would let this user assume
every role in the account that trusts it, which quietly undoes the point of having
roles.

### Hint 4 — The external ID must be supplied, not just configured

The trust policy carries this condition:

```json
"Condition": { "StringEquals": { "sts:ExternalId": "breakfix-2024" } }
```

`ci-deploy.sh` never passes one, so the condition cannot be satisfied and the assume
fails even after both policies are correct. Add `--external-id` to the call.

An external ID is a shared secret that defends against the *confused deputy* problem:
when you let a third party assume a role in your account, it stops them from being
tricked into using your role on behalf of someone else. Within a single account it
adds little, but you must satisfy it if it is configured.

### Hint 5 — Debug the two sides separately

Test the trust policy alone by assuming with your admin credentials — if that works,
the trust side is correct and the problem is the user's identity policy:

```bash
aws sts assume-role --role-arn "$ROLE_ARN" --role-session-name test --external-id breakfix-2024
```

Then test the user's side with the simulator. Splitting the problem in half is much
faster than editing both policies and re-running the pipeline.

Also note that IAM is eventually consistent. After a policy change, wait ten to
fifteen seconds before concluding your fix did not work.

## Solution

Three faults: one on each side of the trust relationship, and one in the call itself.

**Fault 1 — the user cannot call `sts:AssumeRole`.**

```bash
source env.sh

cat > user-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOwnIdentity",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity", "iam:ListRoles"],
      "Resource": "*"
    },
    {
      "Sid": "AssumeTheDeployRole",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "$ROLE_ARN"
    }
  ]
}
EOF

aws iam put-user-policy --user-name "$USER_NAME" \
  --policy-name breakfix-ci-policy --policy-document file://user-policy.json
```

**Fault 2 — the trust policy names the wrong principal.**

```bash
cat > trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCIUserToAssume",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::$ACCOUNT:user/$USER_NAME" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "sts:ExternalId": "breakfix-2024" }
      }
    }
  ]
}
EOF

aws iam update-assume-role-policy --role-name "$ROLE" \
  --policy-document file://trust-policy.json
```

**Fault 3 — the caller never supplies the external ID.** In `ci-deploy.sh`:

```bash
CREDS=$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "ci-deploy-$(date +%s)" \
  --external-id breakfix-2024 \
  --duration-seconds 900 \
  --query Credentials --output json)
```

Verify:

```bash
sleep 15
source use-ci-profile.sh
bash ci-deploy.sh
```

The evaluation order that explains the whole scenario:

1. The caller asks STS to assume the role.
2. STS checks the **caller's identity policy** for `sts:AssumeRole` on that role ARN.
3. STS checks the **role's trust policy** for a matching principal, action and
   conditions.
4. Only if both pass does STS mint temporary credentials.
5. The role's **permission policy** is evaluated later, when those credentials are
   used to call S3.

Steps 2 and 3 are why "but the role has the right permissions" is never an
explanation for an `AssumeRole` failure.

Practices worth adopting from this:

- **Scope `sts:AssumeRole` to specific role ARNs.** A wildcard turns one compromised
  user into access to every role that trusts the account root.
- **Use a meaningful `--role-session-name`.** It appears in every CloudTrail event
  made with those credentials, and it is often the only way to trace an action back to
  a specific pipeline run. Include the build number in real pipelines.
- **Set `--duration-seconds` to the minimum that works.** Sessions default to an hour;
  a deploy that takes two minutes does not need credentials valid for sixty.
- **Prefer OIDC over static keys.** GitHub Actions, GitLab and most CI platforms can
  federate directly, with a trust policy conditioned on the repository and branch.
  There is then no access key to store, leak or rotate — the entire class of secret
  is eliminated rather than managed.

**Teardown:**

```bash
bash teardown.sh
```

## What You Learned

The team spent their time re-checking the role's S3 permissions, which were correct
throughout and had nothing to do with the failure. The error message told them so —
it named `sts:AssumeRole` and the user, not S3 and the role — and it was read past
because "AccessDenied plus a deploy role" pattern-matched to a permissions problem.

Role assumption is a two-key operation: the identity must be allowed to ask, and the
role must be willing to accept. Splitting the diagnosis along that line, and testing
each side independently with admin credentials and the policy simulator, turns a
confusing failure into two simple questions. And in every IAM investigation, the first
move is to read the error message literally: it names the principal, the action and
the resource, and those three facts point directly at which policy to open.
