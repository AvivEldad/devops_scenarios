# AdministratorAccess, and the simulator still says implicitDeny

## Briefing

A contractor user has `AdministratorAccess` attached. `s3:PutObject` is
denied. The bucket policy is empty. There is no explicit Deny in the
identity policy. The account is not in an organisation yet.

A permissions boundary was attached when the user was created from a
"developer" template. Boundaries are not extra Allows. They are a ceiling.
The identity policy can allow the world; the boundary still has to allow
the same action or the result is implicit deny.

This looks like the first S3 lab if you only read the customer-managed
policy and ignore `PermissionsBoundary`.

## Your Task

- Find the boundary on the user and read which actions it allows.
- Explain why `AdministratorAccess` does not win.
- Extend the boundary (or replace it with one that matches the job) so
  PutObject works, without removing the boundary entirely if the org
  requires one.

## Starter Files

### file: user.json

```json
{
  "UserName": "contractor-tmp",
  "AttachedManagedPolicies": [
    "arn:aws:iam::aws:policy/AdministratorAccess"
  ],
  "PermissionsBoundary": {
    "PermissionsBoundaryType": "Policy",
    "PermissionsBoundaryArn": "arn:aws:iam::111122223333:policy/DeveloperBoundary"
  }
}
```

### file: DeveloperBoundary.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DevCeiling",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "logs:*",
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*"
    }
  ]
}
```

### file: simulate.txt

```
Action s3:GetObject  EvalDecision allowed
Action s3:PutObject  EvalDecision implicitDeny
  EvalDecisionDetails: PermissionsBoundary
  MatchedStatements in identity: Allow (AdministratorAccess)
  MatchedStatements in boundary: (none)
```

## Expected Failure

```
aws s3 cp ./file.txt s3://prod-reports/file.txt
# AccessDenied on PutObject
aws s3 cp s3://prod-reports/daily.csv -
# succeeds (GetObject is in the boundary)
```

IAM console still shows AdministratorAccess as attached. That is not a
lie. It is incomplete.

## Expected Outcome

PutObject to the allowed bucket succeeds. The user still has a permissions
boundary. The boundary includes `s3:PutObject` (and `s3:AbortMultipartUpload`
if they upload large files) on the intended resources — not a silent
removal of the ceiling.

## Hints

### Hint 1 — Intersection, not union

Effective permissions = identity policies ∩ boundary ∩ SCPs ∩ session
policy, then minus any Deny. A missing action in the boundary is the same
shape of implicit deny as a missing action in identity, which is why this
is mistaken for lab 01.

### Hint 2 — get-user shows the ARN the console buries

`aws iam get-user` / `get-role` → `PermissionsBoundary`. Then
`get-policy-version`. Simulator fields `PermissionsBoundaryDecisionDetail`
when the boundary is what blocked you.

## Solution

The identity Allow matched. The boundary did not include `s3:PutObject`.

Add the write actions to `DeveloperBoundary` for the buckets this
contractor may touch, or attach a job-specific boundary. Do not "fix" it
by deleting the boundary unless that is an explicit org exception.

```json
{
  "Sid": "DevCeiling",
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:PutObject",
    "s3:AbortMultipartUpload",
    "s3:ListBucket",
    "s3:GetBucketLocation",
    "logs:*",
    "cloudwatch:PutMetricData"
  ],
  "Resource": "*"
}
```

Then tighten `Resource` if this boundary is reused; a ceiling of `*` on a
short action list is still a ceiling.

- **AdministratorAccess is not administrator** when a boundary exists.
- **Creating users from a template** is how leftover boundaries show up
  on "break-glass" accounts.
- **SCPs are next** if there is no boundary and admin still fails.
