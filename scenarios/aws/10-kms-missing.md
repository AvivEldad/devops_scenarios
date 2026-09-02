# S3 is allowed. The object is encrypted. GetObject is still denied.

## Briefing

Default encryption on `prod-reports` was switched to SSE-KMS last week. The
CI identity policy already has the correct bucket ARN for ListBucket and
`/*` for GetObject — this is not the "GetObject on the bucket ARN" lab.

S3 then has to call KMS. The role cannot `kms:Decrypt`. GetObject still
returns `AccessDenied`, so the ticket comes in as "S3 IAM".

## Your Task

- From the bucket encryption settings and the identity policy, name the
  missing action.
- Distinguish this from a wrong object ARN and from a bucket-policy Deny.
- Grant least-privilege KMS on that one key (Decrypt / DescribeKey as
  needed), not `kms:*` on `*`.

## Starter Files

### file: bucket-encryption.json

```json
{
  "ServerSideEncryptionConfiguration": {
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "aws:kms",
          "KMSMasterKeyID": "arn:aws:kms:eu-west-1:111122223333:key/11111111-aaaa-bbbb-cccc-222222222222"
        },
        "BucketKeyEnabled": true
      }
    ]
  }
}
```

### file: identity-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::prod-reports"
    },
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::prod-reports/*"
    }
  ]
}
```

### file: cloudtrail-kms.json

```json
{
  "eventSource": "kms.amazonaws.com",
  "eventName": "Decrypt",
  "errorCode": "AccessDenied",
  "userIdentity": {
    "arn": "arn:aws:sts::111122223333:assumed-role/ci-reports/job-88"
  },
  "requestParameters": {
    "encryptionContext": {
      "aws:s3:arn": "arn:aws:s3:::prod-reports/daily.csv"
    }
  }
}
```

## Expected Failure

```
aws s3 ls s3://prod-reports/
# works  (ListBucket does not decrypt object bytes)

aws s3 cp s3://prod-reports/daily.csv -
# AccessDenied on GetObject
```

SSE-S3 (AES256) objects in the same bucket would download. KMS objects would
not. HeadObject may also fail. The S3 identity policy looks complete.

## Expected Outcome

GetObject returns the object. IAM has `kms:Decrypt` (and typically
`kms:DescribeKey`) on **that CMK ARN only**. `kms:*` on `*` is not the fix.
SSE-K3 / bucket-key stays enabled.

## Hints

### Hint 1 — List can succeed while Get fails

Listing metadata is an S3 API. Reading bytes of an SSE-KMS object is S3 plus
KMS. A policy that only mentions `s3:` is unfinished after a default-
encryption change.

### Hint 2 — Look at kms.amazonaws.com in CloudTrail, not only s3

Filter `errorCode=AccessDenied` and `eventSource=kms.amazonaws.com`. The
S3 event is a symptom. The KMS `Decrypt` event is the cause. If there is
**no** KMS event, you are in a different lab (ARN, bucket Deny, wrong
region).

## Solution

The CMK is a second resource. Grant the role decrypt on that key. Confirm
the **key policy** already allows this account to use IAM (the default). If
the key policy names roles explicitly and omits CI, that is the key-policy
lab, not this one.

```json
{
  "Sid": "DecryptObjects",
  "Effect": "Allow",
  "Action": ["kms:Decrypt", "kms:DescribeKey"],
  "Resource": "arn:aws:kms:eu-west-1:111122223333:key/11111111-aaaa-bbbb-cccc-222222222222",
  "Condition": {
    "StringEquals": {
      "kms:ViaService": "s3.eu-west-1.amazonaws.com"
    }
  }
}
```

Writers also need `kms:GenerateDataKey`. Readers need Decrypt.

- **Default encryption changes are IAM changes.**
- **Do not add `s3:*`.** You already had GetObject.
- **Prefer a CMK you can policy** over hoping `aws/s3` will just work.
