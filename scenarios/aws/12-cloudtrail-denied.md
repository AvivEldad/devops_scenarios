# CloudTrail says ListBuckets. The policy says ListBucket.

## Briefing

The new auditor role is supposed to list every bucket in the account, then
deep-list one of them. Someone granted `s3:ListBucket` on `*`. `aws s3 ls`
with no bucket argument still fails. CloudTrail is unambiguous if you read
`eventName` instead of the policy Sid.

This is not the object-ARN lab. The action they granted is real. It is the
wrong action for the call they made.

## Your Task

- From the CloudTrail event, name the IAM action the CLI actually needed.
- Map `aws s3 ls` (no path) vs `aws s3 ls s3://bucket/` to two different
  permissions.
- Grant `s3:ListAllMyBuckets` for the account listing, keep `s3:ListBucket`
  scoped to the one bucket you intend to inspect.

## Starter Files

### file: auditor-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IThoughtThisListedBuckets",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "*"
    }
  ]
}
```

### file: cloudtrail-event.json

```json
{
  "eventSource": "s3.amazonaws.com",
  "eventName": "ListBuckets",
  "awsRegion": "us-east-1",
  "errorCode": "AccessDenied",
  "errorMessage": "Access Denied",
  "userIdentity": {
    "arn": "arn:aws:sts::111122223333:assumed-role/auditor/job-1"
  },
  "requestParameters": { "Host": "s3.amazonaws.com" },
  "additionalEventData": { "AuthenticationMethod": "AuthHeader" }
}
```

### file: commands.sh

```bash
aws s3 ls
# AccessDenied   ← this is ListBuckets / s3:ListAllMyBuckets, resource "*"

aws s3 ls s3://prod-reports/
# may succeed with ListBucket on "*"   ← different API
```

## Expected Failure

```
aws s3 ls
# An error occurred (AccessDenied) when calling the ListBuckets operation
```

CloudTrail `eventName` is `ListBuckets`, not `ListBucket` or `ListObjects`.
The identity policy never mentioned `s3:ListAllMyBuckets`. `Resource: "*"`
on the wrong action does not help.

## Expected Outcome

```
aws s3 ls
# 2026-04-01  prod-reports
# 2026-04-01  logs-111122223333

aws s3 ls s3://prod-reports/
# daily.csv
```

Account listing uses `s3:ListAllMyBuckets` on `*`. Object listing of one
bucket uses `s3:ListBucket` on `arn:aws:s3:::prod-reports`, not on `*`.

## Hints

### Hint 1 — The extra letter in the event name

S3 IAM names and CloudTrail `eventName`s do not always match the CLI verb.
`ListBuckets` (plural) → `s3:ListAllMyBuckets`. `ListObjects` /
`ListObjectsV2` → `s3:ListBucket`. Granting the name you see in a blog
(`ListBucket`) does not authorize the call with no bucket.

### Hint 2 — Resource "*" is required for ListAllMyBuckets and still wrong for ListBucket

`ListAllMyBuckets` has no bucket — the resource is `*`. That does not mean
your ListBucket statement should also be `*`. Once the account list works,
scope the per-bucket list.

## Solution

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListAccountBuckets",
      "Effect": "Allow",
      "Action": "s3:ListAllMyBuckets",
      "Resource": "*"
    },
    {
      "Sid": "ListOneBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::prod-reports"
    }
  ]
}
```

- **Debug AccessDenied from CloudTrail `eventName`**, then look up the IAM
  action. Do not guess from the CLI subcommand.
- **`ListBucket` on `*`** is a different (usually worse) policy than
  `ListAllMyBuckets`.
- **This lab is the API name.** Lab 01 was the ARN shape on GetObject.
