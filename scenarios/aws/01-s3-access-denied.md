# AccessDenied on a bucket you own

## Briefing

You are giving a CI job read access to one S3 bucket. You create a user, write what
looks like a perfectly reasonable policy, attach it, and every call fails:

```
An error occurred (AccessDenied) when calling the ListObjectsV2 operation: Access Denied
```

You own the bucket. You are the account administrator. The policy names the bucket.
And IAM says no.

This is the single most common IAM mistake, and once you have seen why, you will spot
it in code review for the rest of your career.

> **You bring the AWS account.** This scenario creates an IAM user, an access key, a
> policy and a small bucket. Cost is effectively zero, but you must run the teardown
> at the end. Never do this in a production account — use a sandbox.

## Your Task

1. Run the setup to create the bucket, the user and the broken policy.
2. Confirm the failure using the second user's credentials, not your own.
3. Work out from the API calls and the policy why access is denied.
4. Fix the policy so the CI user can list the bucket and read objects — and **only**
   that bucket, with no wildcard on resources.
5. Tear everything down.

```bash
mkdir -p ~/breakfix/aws-01 && cd ~/breakfix/aws-01
aws sts get-caller-identity     # confirm which account you are about to touch
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Creates a bucket, an IAM user with a deliberately broken policy, and test objects.
set -euo pipefail

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGION="${AWS_REGION:-eu-west-1}"
BUCKET="breakfix-lab-${ACCOUNT}-s3"
USER="breakfix-ci-reader"

echo "account=$ACCOUNT region=$REGION bucket=$BUCKET"

# --- bucket with a couple of objects ---
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
fi

echo "build 42 artifact" > /tmp/artifact.txt
echo "release notes"     > /tmp/notes.txt
aws s3 cp /tmp/artifact.txt "s3://$BUCKET/builds/artifact.txt"
aws s3 cp /tmp/notes.txt    "s3://$BUCKET/notes.txt"

# --- the broken policy ---
cat > policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadTheBucket",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::$BUCKET"
    }
  ]
}
EOF

aws iam create-user --user-name "$USER" 2>/dev/null || true
aws iam put-user-policy --user-name "$USER" \
  --policy-name breakfix-s3-read \
  --policy-document file://policy.json

# --- access key for testing ---
aws iam create-access-key --user-name "$USER" --output json > key.json
echo "credentials written to key.json (delete this file at teardown)"

cat > use-ci-profile.sh <<'EOF'
# source this to become the CI user in your current shell
export AWS_ACCESS_KEY_ID="$(python3 -c 'import json;print(json.load(open("key.json"))["AccessKey"]["AccessKeyId"])')"
export AWS_SECRET_ACCESS_KEY="$(python3 -c 'import json;print(json.load(open("key.json"))["AccessKey"]["SecretAccessKey"])')"
unset AWS_SESSION_TOKEN
echo "now acting as: $(aws sts get-caller-identity --query Arn --output text)"
EOF

echo
echo "Setup complete. Bucket: $BUCKET"
echo "New IAM access keys take a few seconds to become usable."
```

### file: teardown.sh

```bash
#!/usr/bin/env bash
# Removes everything this scenario created. Run with YOUR admin credentials.
set -euo pipefail

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="breakfix-lab-${ACCOUNT}-s3"
USER="breakfix-ci-reader"

aws s3 rm "s3://$BUCKET" --recursive || true
aws s3api delete-bucket --bucket "$BUCKET" || true

aws iam delete-user-policy --user-name "$USER" --policy-name breakfix-s3-read || true
for k in $(aws iam list-access-keys --user-name "$USER" \
             --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
  aws iam delete-access-key --user-name "$USER" --access-key-id "$k"
done
aws iam delete-user --user-name "$USER" || true

rm -f key.json policy.json use-ci-profile.sh
echo "teardown complete"
```

## Expected Failure

```bash
bash setup.sh
sleep 15                 # IAM is eventually consistent; new keys need a moment

# open a NEW shell so your admin credentials are not in scope
source use-ci-profile.sh
```

Now every call fails:

```bash
aws s3 ls s3://breakfix-lab-<account>-s3/
# An error occurred (AccessDenied) when calling the ListObjectsV2 operation: Access Denied

aws s3 cp s3://breakfix-lab-<account>-s3/notes.txt -
# An error occurred (AccessDenied) when calling the GetObject operation: Access Denied
```

The policy explicitly allows `s3:ListBucket` and `s3:GetObject` on that exact bucket.
Both are denied anyway.

Return to your admin shell (or open a new terminal) before running the diagnostics in
the hints.

## Expected Outcome

The CI user can list the bucket and read objects, and can do nothing else.

Listing works:

```bash
source use-ci-profile.sh
aws s3 ls "s3://breakfix-lab-${ACCOUNT}-s3/"
#                           PRE builds/
# 2026-08-31 10:00:00         14 notes.txt

aws s3 ls "s3://breakfix-lab-${ACCOUNT}-s3/builds/"
# 2026-08-31 10:00:00         18 artifact.txt
```

Reading works:

```bash
aws s3 cp "s3://breakfix-lab-${ACCOUNT}-s3/builds/artifact.txt" -
# build 42 artifact
```

Writing is still denied, because this is a read-only role:

```bash
echo x > /tmp/x.txt
aws s3 cp /tmp/x.txt "s3://breakfix-lab-${ACCOUNT}-s3/x.txt"
# AccessDenied      <- this failure is REQUIRED
```

Other buckets are still denied:

```bash
aws s3 ls
# AccessDenied on ListAllMyBuckets, or an empty list - either is acceptable,
# but it must NOT show buckets it has no business seeing
```

The policy contains no `"Resource": "*"`:

```bash
# from your admin shell
aws iam get-user-policy --user-name breakfix-ci-reader \
  --policy-name breakfix-s3-read --output json | grep -c '"\*"'
# 0
```

The simulator agrees, which is the check to trust:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn "arn:aws:iam::${ACCOUNT}:user/breakfix-ci-reader" \
  --action-names s3:ListBucket s3:GetObject s3:PutObject \
  --resource-arns "arn:aws:s3:::breakfix-lab-${ACCOUNT}-s3" \
                  "arn:aws:s3:::breakfix-lab-${ACCOUNT}-s3/builds/artifact.txt" \
  --query 'EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision}' \
  --output table
# ListBucket allowed, GetObject allowed, PutObject implicitDeny
```

Finally, tear down:

```bash
bash teardown.sh
```

## Hints

### Hint 1 — S3 has two kinds of resource ARN

This is the entire bug:

| ARN | Refers to | Used by |
|---|---|---|
| `arn:aws:s3:::my-bucket` | the bucket itself | `s3:ListBucket`, `s3:GetBucketLocation` |
| `arn:aws:s3:::my-bucket/*` | the objects inside it | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` |

They are different resources. A policy granting `s3:GetObject` on
`arn:aws:s3:::my-bucket` grants object access on *the bucket*, which is not a thing —
so it matches nothing and the implicit deny applies.

You need two statements, because the two action groups act on two different resource
types.

### Hint 2 — Bucket-level and object-level operations are distinct

`s3:ListBucket` is a *bucket* operation. Note that `aws s3 ls s3://bucket/prefix/`
calls `ListObjectsV2`, which requires `s3:ListBucket` on the **bucket** ARN — not
`s3:ListObjects` (which is not a real IAM action) and not the object ARN.

`s3:GetObject` is an *object* operation and needs the `/*` form.

Getting this backwards produces exactly the symptom you are seeing, and the error
message never mentions the ARN mismatch.

### Hint 3 — Let the simulator explain the decision

Rather than guessing, ask IAM:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::<account>:user/breakfix-ci-reader \
  --action-names s3:ListBucket \
  --resource-arns arn:aws:s3:::breakfix-lab-<account>-s3
```

`EvalDecision` will be `implicitDeny` — meaning nothing matched and allowed it, as
opposed to `explicitDeny`, which would mean a `Deny` statement matched. That
distinction tells you whether to add an allow or remove a deny, and it is the first
question to answer in any AccessDenied investigation.

CloudTrail is the other source of truth: look up the failed event and read the
`resources` and `errorCode` fields to see exactly what was requested.

### Hint 4 — Scope the read policy properly

Once it works, tighten it. If CI only needs the `builds/` prefix, the object
statement should say `arn:aws:s3:::bucket/builds/*`, and you can constrain
`ListBucket` to that prefix with a condition:

```json
"Condition": { "StringLike": { "s3:prefix": ["builds/*"] } }
```

Resist the temptation to "just make it work" with `"Resource": "*"`. That single
character is how a CI job that should read one bucket ends up able to read every
bucket in the account.

## Solution

`s3:GetObject` acts on objects, whose ARNs end in `/*`, and the policy granted it on
the bucket ARN. `s3:ListBucket` acts on the bucket and was correct — but with both
actions sharing one statement and one resource, only one of them could ever have been
right.

The corrected policy, split by resource type:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListTheBucket",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::breakfix-lab-ACCOUNT-s3"
    },
    {
      "Sid": "ReadObjects",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::breakfix-lab-ACCOUNT-s3/*"
    }
  ]
}
```

Apply it with your admin credentials:

```bash
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
sed -i "s/ACCOUNT/$ACCOUNT/g" policy.json

aws iam put-user-policy --user-name breakfix-ci-reader \
  --policy-name breakfix-s3-read \
  --policy-document file://policy.json

sleep 10
source use-ci-profile.sh
aws s3 ls "s3://breakfix-lab-${ACCOUNT}-s3/"
```

How IAM actually reaches a decision, which is worth holding in your head as a
checklist when something is denied:

1. An **explicit Deny** anywhere wins, always. Nothing overrides it.
2. Otherwise, an **Allow** must match — the action, the resource ARN, and any
   conditions — in an identity policy or a resource policy.
3. If nothing matches, the result is an **implicit Deny**. This is the default and it
   is what you hit here.

For an S3 request specifically, the request must be permitted by the identity policy,
and not denied by the bucket policy, any permission boundary, an SCP at the
organisation level, or Block Public Access. When a request is denied and your
identity policy looks correct, work down that list in order.

A production note: static access keys for a CI user are the pattern this scenario
uses because it is the clearest way to demonstrate policy evaluation, but it is not
what you should build. Prefer an IAM role assumed via OIDC — GitHub Actions, GitLab
and most CI systems support it — so there is no long-lived secret to leak or rotate.
That is the subject of the expert AWS scenario.

**Do not forget teardown:**

```bash
bash teardown.sh
```

## What You Learned

The policy read correctly in English and was wrong in IAM's terms, because S3 models
a bucket and its objects as two separate resources with two separate ARN forms. The
error message said only `Access Denied`, which is deliberate — telling an unauthorised
caller *why* they were refused is itself an information leak.

That is why `simulate-principal-policy` matters so much: it gives you the evaluation
detail the API refuses to. Combined with the deny-precedence rules, it turns IAM from
guesswork into something you can reason about, and the distinction between
`implicitDeny` and `explicitDeny` immediately tells you whether you are missing an
allow or fighting a deny somewhere above you.
