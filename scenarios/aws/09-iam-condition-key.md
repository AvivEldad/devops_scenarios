# The condition that never matches

## Briefing

CI should list only `builds/` and read only `builds/*`. The policy looks
tight. Every ListBucket and GetObject is implicitly denied. There is no
explicit Deny anywhere.

Two faults landed in the same `Condition` block: the operator treats `*` as
a literal, and a key that only exists for IAM *users* was copied onto a
*role*. The Allow statement is present. Its condition is never true.

## Your Task

- Decide whether this is `explicitDeny` or `implicitDeny`.
- Name both condition bugs (operator, and key that is unset on a role).
- Rewrite the condition so prefix listing works for the assumed role, without
  opening the rest of the bucket.

## Starter Files

### file: ci-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBuildsOnly",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::prod-reports",
      "Condition": {
        "StringEquals": {
          "s3:prefix": "builds/*",
          "aws:username": "ci-reports"
        }
      }
    },
    {
      "Sid": "GetBuilds",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::prod-reports/builds/*"
    }
  ]
}
```

### file: caller.txt

```
aws sts get-caller-identity
{
  "UserId": "AROAEXAMPLE:job-88",
  "Account": "111122223333",
  "Arn": "arn:aws:sts::111122223333:assumed-role/ci-reports/job-88"
}
# this is a role session. there is no IAM user named ci-reports.
```

## Expected Failure

```
aws s3 ls s3://prod-reports/builds/
# AccessDenied   (ListObjectsV2 → s3:ListBucket)

aws s3 cp s3://prod-reports/builds/artifact.txt -
# may work if GetObject's statement has no condition
# the list call is what the job dies on
```

Simulator: `implicitDeny` on `s3:ListBucket`. `EvalDecisionDetails` /
missing context: `aws:username` is not present on an assumed role. Even if
you dropped that key, `StringEquals` + `builds/*` still would not match the
prefix `builds/` or `builds/artifact.txt`.

## Expected Outcome

```
aws s3 ls s3://prod-reports/builds/
# artifact.txt

aws s3 ls s3://prod-reports/
# AccessDenied   # listing the bucket root is still out of scope
```

GetObject on `builds/*` still works. No `"Resource": "*"` on ListBucket.

## Hints

### Hint 1 — StringEquals does not glob

`s3:prefix` is compared as a string. `StringEquals` `"builds/*"` matches
only a prefix that is the five characters `b u i l d s / *`. ListObjects
with `--prefix builds/` sends `s3:prefix=builds/` (no star). Use
`StringLike` with `builds/*`, or `StringEquals` with `builds/` and
`builds` as separate values.

### Hint 2 — aws:username is for IAM users

Role sessions expose `aws:userid`, `aws:PrincipalArn`, `aws:PrincipalTag/*`.
They do not expose `aws:username`. A `StringEquals` on a missing key does
not match, so the Allow never applies. That is implicit deny, not a Deny
statement.

## Solution

Drop `aws:username`. Use `StringLike` for the prefix glob. Restrict objects
with the resource ARN, not a fake username check.

```json
{
  "Sid": "ListBuildsOnly",
  "Effect": "Allow",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::prod-reports",
  "Condition": {
    "StringLike": { "s3:prefix": ["builds", "builds/*"] }
  }
}
```

- **`s3:prefix` only applies to ListBucket**, not GetObject. Object
  restriction belongs on `Resource`.
- **Copy-pasting user conditions onto roles** is a silent implicit deny.
- **Read the operator.** `StringEquals`, `StringLike`, `ArnLike` are not
  interchangeable.
