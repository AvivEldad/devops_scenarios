# AssumeRole succeeded. Every API call after it is denied.

## Briefing

CI assumes `breakfix-deploy-role` without error. That already distinguishes
this from the trust-policy lab. The next line is PutObject AccessDenied.
The role's identity policy allows `s3:PutObject` on the bucket.

The assume call passes `--policy` / `Policy` (an inline session policy)
copied from a read-only job. Session policies can only **narrow**. They
cannot grant what the role does not have, and they hide what the role
does have. People keep adding statements to the role. The session still
intersects to GetObject only.

## Your Task

- From the assume-role invocation, extract the session policy.
- Show that trust and role identity are already sufficient.
- Remove or rewrite the session policy so PutObject is allowed, without
  dropping the session policy if you still need a per-job ceiling.

## Starter Files

### file: assume.sh

```bash
#!/usr/bin/env bash
# CI wrapper — trust is fine; this Policy= is the ceiling for the session
aws sts assume-role \
  --role-arn arn:aws:iam::111122223333:role/breakfix-deploy-role \
  --role-session-name "github-${GITHUB_RUN_ID}" \
  --policy file://session.json \
  --duration-seconds 3600
```

### file: session.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::prod-reports",
        "arn:aws:s3:::prod-reports/*"
      ]
    }
  ]
}
```

### file: role-identity.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:AbortMultipartUpload"],
      "Resource": [
        "arn:aws:s3:::prod-reports",
        "arn:aws:s3:::prod-reports/*"
      ]
    }
  ]
}
```

## Expected Failure

```
aws sts assume-role ...   # succeeds; creds in env
aws sts get-caller-identity
# arn:aws:sts::111122223333:assumed-role/breakfix-deploy-role/github-88

aws s3 cp artifact.tgz s3://prod-reports/builds/artifact.tgz
# AccessDenied  PutObject

aws s3 cp s3://prod-reports/notes.txt -
# succeeds (GetObject is in the session policy)
```

Trust policy is not involved. `simulate-principal-policy` on the role
without a session policy shows PutObject allowed.

## Expected Outcome

PutObject from the session works. The role policy is unchanged (it was
already right). Session policy either omitted, or includes `s3:PutObject`
on the same ARNs. AssumeRole still succeeds.

## Hints

### Hint 1 — Intersection with the session

Effective = role identity ∩ session policy ∩ boundary ∩ SCP, minus Deny.
A session Allow of GetObject is a ceiling, not a bug in the role.

### Hint 2 — Who injected Policy=

GitHub Actions `aws-actions/configure-aws-credentials` `role-to-assume`
plus `inline-session-policy`, Jenkins `withAWS`, or a wrapper script.
`sts get-caller-identity` will not show it. The assume-role API call in
CloudTrail has `requestParameters.policy`.

## Solution

Delete `--policy file://session.json` if the role is already scoped, or
extend the session document:

```json
"Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:AbortMultipartUpload"]
```

Do not attach `AmazonS3FullAccess` to the role to "overpower" a session
policy — you cannot.

- **Trust vs session:** lab 03 is AccessDenied on AssumeRole. Here
  AssumeRole is the only call that *works*.
- **Permission boundaries** are a similar ceiling; they live on the
  role, not in the assume call.
- **Packed policy too large** is a different AssumeRole error; this one
  assumes successfully.
