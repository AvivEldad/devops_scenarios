# Cross-account GetObject dies on a CMK you do not own

## Briefing

Account B (`444455556666`) must read objects from account A's bucket
`prod-reports`. The objects are SSE-KMS with a CMK in A. B's role has
`s3:GetObject` and `kms:Decrypt`. A's bucket policy allows B's role.
GetObject still fails with AccessDenied or KMS `InvalidCiphertext` /
`AccessDenied`.

Two parties, three documents: **B identity**, **A bucket policy**, **A
key policy**. Updating only IAM in B, or only the bucket policy, is the
usual incomplete change. Labs 10 and 25 are same-account; the caller here
is a different account.

## Your Task

- Inventory the three policies. Find which side was never updated.
- Explain why S3 and KMS both have to allow B.
- Add B's role to A's key policy (the missing piece in the starter
  files) without granting B `kms:*` or making the bucket public.

## Starter Files

### file: account-b-identity.json

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
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:eu-west-1:111122223333:key/11111111-aaaa-bbbb-cccc-222222222222"
    }
  ]
}
```

### file: account-a-bucket-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccountB",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::444455556666:role/data-reader" },
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::prod-reports",
        "arn:aws:s3:::prod-reports/*"
      ]
    }
  ]
}
```

### file: account-a-key-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Enable IAM User Permissions",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
      "Action": "kms:*",
      "Resource": "*"
    }
  ]
}
```

## Expected Failure

From B:

```
aws s3 cp s3://prod-reports/daily.csv -
# AccessDenied
# CloudTrail in A: GetObject + KMS Decrypt AccessDenied for
# arn:aws:sts::444455556666:assumed-role/data-reader/...
```

ListBucket may work (no object decrypt). GetObject of SSE-S3 objects
would work; KMS objects would not. A's root IAM statement does **not**
let B's IAM policies apply — that statement is only for account A.

## Expected Outcome

B can GetObject on KMS-encrypted keys. A's key policy has a statement
for `arn:aws:iam::444455556666:role/data-reader` with Decrypt. B's
identity still names the key ARN in A. Bucket policy unchanged. No
`Principal "*"` on the key.

## Hints

### Hint 1 — Account-A root is not account-B IAM

`arn:aws:iam::111122223333:root` in the key policy means "IAM in A may
authorize A principals". B is not A. B needs its own principal block on
the key.

### Hint 2 — Cross-account S3 always needs the bucket policy

Even with a working CMK, same-account-style "identity only" is not
enough for B. Here the bucket policy is already done; the CMK is not.
If both were missing you would fix both.

## Solution

In account A, add to the key:

```json
{
  "Sid": "AllowBDecrypt",
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::444455556666:role/data-reader" },
  "Action": ["kms:Decrypt", "kms:DescribeKey"],
  "Resource": "*"
}
```

Optional: `kms:ViaService` for S3. B does not copy the CMK; it calls A's
key with its own creds.

- **Three documents, two accounts.** Tick them off.
- **SSE-S3** would have hidden the KMS half of this incident.
- **Grants** are an alternative for some AWS services; B still needs Decrypt.
