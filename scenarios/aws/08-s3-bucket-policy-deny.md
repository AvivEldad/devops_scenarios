# IAM allows GetObject. The bucket policy does not.

## Briefing

The CI role can `sts get-caller-identity`. Its identity policy allows
`s3:ListBucket` on the bucket ARN and `s3:GetObject` on `bucket/*` — the
split from the first S3 lab is already done. GetObject is still denied.

Last quarter someone answered a ransomware ticket with a bucket policy Deny
"until we know who needs this data". The identity side was never the
bottleneck. Resource policies are in the same evaluation as identity
policies, and an explicit Deny in either place wins.

## Your Task

- Separate "identity Allow" from "bucket policy Deny".
- Predict `explicitDeny` from the bucket policy statement, not an ARN typo.
- Change the bucket policy so this role can read, without making the bucket
  public and without attaching `AmazonS3FullAccess`.

## Starter Files

### file: identity-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "List",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::prod-reports"
    },
    {
      "Sid": "Read",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::prod-reports/*"
    }
  ]
}
```

### file: bucket-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IR-441-Quarantine",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::prod-reports",
        "arn:aws:s3:::prod-reports/*"
      ],
      "Condition": {
        "StringNotEquals": {
          "aws:PrincipalArn": "arn:aws:iam::111122223333:role/break-glass"
        }
      }
    }
  ]
}
```

### file: cloudtrail-snippet.json

```json
{
  "eventName": "GetObject",
  "errorCode": "AccessDenied",
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::111122223333:assumed-role/ci-reports/job-88"
  },
  "requestParameters": { "bucketName": "prod-reports", "key": "daily.csv" }
}
```

## Expected Failure

```
aws s3 cp s3://prod-reports/daily.csv -
# AccessDenied
```

Identity simulation *without* the resource policy can show `allowed`. The
real request still hits the bucket policy. `Principal "*"` plus
`StringNotEquals` break-glass means everyone except that role is denied —
including CI.

## Expected Outcome

CI GetObject and ListBucket succeed. The bucket is not public (`Principal`
is not `*` on an Allow). Break-glass still works. If quarantine must stay,
CI's role ARN is on the NotEquals list (or the Deny is removed and replaced
with least-privilege Allows).

## Hints

### Hint 1 — Same-account Allow is not enough if a Deny exists

For S3 in the same account, identity **or** bucket Allow can permit a
request — until any Deny matches. A quarantine Deny on `Principal "*"` is
the whole story. Do not "fix" the object ARN again.

### Hint 2 — simulate-principal-policy does not include the bucket policy

That API evaluates identity (and boundaries). It will happily say `allowed`
while the bucket refuses. Read `get-bucket-policy`. CloudTrail will not
name the Sid for you.

## Solution

The identity policy was already correct. IR-441 denied every principal but
`break-glass`.

Either end the quarantine, or list the CI role next to break-glass:

```json
"Condition": {
  "StringNotEquals": {
    "aws:PrincipalArn": [
      "arn:aws:iam::111122223333:role/break-glass",
      "arn:aws:iam::111122223333:role/ci-reports"
    ]
  }
}
```

- **Bucket policy Deny vs missing object `/*`** are different labs. Here the
  `/*` is already present.
- **Identity simulator lies by omission** when the deny is on the resource.
- **Quarantine Denies** need an expiry and a named allow-list, not `*`
  forever.
