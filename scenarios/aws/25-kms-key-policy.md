# IAM allows kms:Decrypt. The key policy does not.

## Briefing

SSE-KMS GetObject is denied. Unlike the "forgot kms on the IAM role"
lab, this role **already** has `kms:Decrypt` on the CMK ARN. CloudTrail
shows KMS `Decrypt` AccessDenied anyway.

KMS is not S3. A key policy that lists only `role/admin` and
`role/backup` does not fall through to IAM for everyone else. The
default statement "Allow this account's IAM policies to apply" was
removed during a lock-down. Until the key policy names `role/ci-reports`
(or restores account-level IAM delegation), identity `kms:Decrypt` is
trivia.

## Your Task

- Read the key policy and the role's identity policy. Say which layer
  refused.
- Distinguish this from missing `kms:Decrypt` in IAM (lab 10).
- Add the role to the key policy (or restore the account IAM statement
  plus keep IAM tight). Do not make the key `Principal "*"`.

## Starter Files

### file: identity-policy.json

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

### file: key-policy.json

```json
{
  "Version": "2012-10-17",
  "Id": "lockdown",
  "Statement": [
    {
      "Sid": "EnableAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/admin" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "Backup",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/backup" },
      "Action": ["kms:Decrypt", "kms:DescribeKey", "kms:CreateGrant"],
      "Resource": "*"
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
  }
}
```

## Expected Failure

GetObject AccessDenied. IAM simulator for `kms:Decrypt` on the role may
show `allowed` — it is not evaluating the key policy. `admin` can decrypt
the same object. CI cannot.

## Expected Outcome

CI Decrypt succeeds. Key policy includes `ci-reports` with Decrypt (and
`kms:ViaService` = S3 if you want). Account root/admin still manages the
key. No `kms:*` for CI. Lab 10's IAM statement stays.

## Hints

### Hint 1 — Default key policy is the IAM bridge

The AWS-generated statement allows
`arn:aws:iam::ACCOUNT:root` `kms:*`, which means "honour IAM in this
account". Delete that statement and **only** the principals listed in
the key policy can use the key, regardless of IAM.

### Hint 2 — Simulator vs actual Decrypt

`simulate-principal-policy` does not apply key policies. CloudTrail on
`kms.amazonaws.com` plus `get-key-policy` is the pair that tells the
truth.

## Solution

Grant the role on the key, keep IAM as the second gate:

```json
{
  "Sid": "CiDecryptViaS3",
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::111122223333:role/ci-reports" },
  "Action": ["kms:Decrypt", "kms:DescribeKey"],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "kms:ViaService": "s3.eu-west-1.amazonaws.com"
    }
  }
}
```

Restoring the root IAM-delegation statement is also valid; then lab 10's
identity policy is the source of truth again.

- **KMS always checks the key policy first.**
- **Cross-account** needs this *and* the caller's IAM (next lab).
- **Do not attach `AdministratorAccess`** to paper over a key policy.
