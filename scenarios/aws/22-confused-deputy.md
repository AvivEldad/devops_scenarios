# The service can assume this role from any account

## Briefing

Replication (or inventory, or EventBridge) uses `role/s3-replicate`.
Objects started appearing in the destination bucket that this account
never wrote. The trust policy allows `s3.amazonaws.com` to `AssumeRole`
with no `aws:SourceAccount` or `aws:SourceArn`.

That is the confused-deputy pattern: a service in *some other* AWS
account can be talked into assuming *your* role if the service will
accept a role ARN you do not own. You are not writing an attack. You are
closing the trust.

`Principal "*"` on a trust policy is the same class of bug, louder.

## Your Task

- Read the trust policy. Name what is missing for a service principal.
- Explain why the role's *identity* policy (S3 write) is not the bug.
- Add `aws:SourceAccount` and `aws:SourceArn` (or equivalent) so only
  your bucket's S3 service can assume the role.

## Starter Files

### file: trust-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3Assume",
      "Effect": "Allow",
      "Principal": { "Service": "s3.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### file: identity-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ObjectOwnerOverrideToBucketOwner", "s3:GetObjectVersionForReplication"],
      "Resource": "arn:aws:s3:::dr-reports/*"
    }
  ]
}
```

### file: notes.txt

```
role: arn:aws:iam::111122223333:role/s3-replicate
intended source bucket: arn:aws:s3:::prod-reports   (account 111122223333)
destination:            arn:aws:s3:::dr-reports
# AssumeRole succeeded for S3 in this account — and would for S3 acting
# on a bucket in another account that named this role ARN.
```

## Expected Failure

The configuration "works" for legitimate replication, so there is no
AccessDenied to chase. The failure is the trust: any S3 principal that
can be pointed at this role ARN can assume it. Security review / IAM
Access Analyzer flags `AssumeRole` with a service principal and no
source condition.

If you *did* set a condition later with the wrong bucket ARN,
replication in *this* account would start getting `AccessDenied` on
AssumeRole — that is the same file, opposite symptom.

## Expected Outcome

Trust policy still has `s3.amazonaws.com`. Conditions pin the caller:

- `aws:SourceAccount` = `111122223333`
- `aws:SourceArn` = `arn:aws:s3:::prod-reports`

Replication from `prod-reports` still works. Analyzer no longer reports
the unconstrained service trust. Role policy is unchanged.

## Hints

### Hint 1 — Trust is who may become the role

Lab 03 was CI user vs role trust. Here the principal is a service. Service
principals without source conditions are cross-account by nature of the
service. Identity policy only says what happens *after* assume.

### Hint 2 — SourceArn is the resource that invoked the service

For S3 replication, that is the **source bucket ARN**, not the role ARN
and not `*`. `sts:ExternalId` is a different control (third-party humans /
SaaS) — next cousin lab.

## Solution

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "s3.amazonaws.com" },
  "Action": "sts:AssumeRole",
  "Condition": {
    "StringEquals": { "aws:SourceAccount": "111122223333" },
    "ArnLike": { "aws:SourceArn": "arn:aws:s3:::prod-reports" }
  }
}
```

Never ship `"Principal": "*"` on a trust policy. If you find it, replace
it with the account or service you intend, plus a condition.

- **Confused deputy** = tricking a more privileged service to act on
  your role. Conditions bind the deputy to *your* resource.
- **Do not test this by attacking another account.** Read Analyzer and
  the policy.
- **Lambda `lambda.amazonaws.com`, EventBridge, CloudTrail** need the
  same SourceArn/SourceAccount treatment.
