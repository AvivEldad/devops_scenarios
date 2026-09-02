# The bucket policy is public. Block Public Access is on.

## Briefing

Static site, `index.html` in S3, bucket policy `Principal: "*"`
`s3:GetObject`. The object ACL is private (default). Website endpoint and
the object URL both return 403.

Account-level S3 Block Public Access was enabled in a security baseline.
`RestrictPublicBuckets` ignores public bucket policies. The policy document
is still there; it does not apply. People then add `AmazonS3FullAccess` to
a CloudFront OAI that does not exist yet.

The inverse also happens: BPA off, policy not actually public (missing
`/*`, or `NotPrincipal` mistake). Start by reading BPA, then the policy.

## Your Task

- Read account and bucket public-access-block. Decide which switch is
  killing the public policy.
- State whether this site should be public at all. If yes, turn off the
  *bucket* block with a ticket; if no, do not disable BPA — use CloudFront
  OAC instead.
- Do not chmod objects to `public-read` as the fix while BPA is on — ACL
  public is blocked by `BlockPublicAcls` anyway.

## Starter Files

### file: bucket-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::www-example-com/*"
    }
  ]
}
```

### file: public-access-block.json

```json
{
  "Bucket": "www-example-com",
  "PublicAccessBlockConfiguration": {
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }
}
```

### file: curl.txt

```
curl -si http://www-example-com.s3-website-eu-west-1.amazonaws.com/
# HTTP/1.1 403 Forbidden
# x-amz-error-code: AccessDenied

aws s3api get-bucket-policy-status --bucket www-example-com
# Policy is not public   ← BPA made the public statement ineffective
```

## Expected Failure

Anonymous GET is 403. Authenticated admin GET works. Policy JSON still
shows `Principal "*"`. `get-bucket-policy-status` reports not public.
CloudFront (if any) is a separate 403 until OAC exists.

## Expected Outcome

You pick one architecture:

1. **Truly public website:** bucket-level BPA `BlockPublicPolicy` and
   `RestrictPublicBuckets` false, policy remains `Principal "*"` GetObject
   on `/*`. Account-level BPA may still force this off — then the account
   setting is the real gate.
2. **Private origin:** leave BPA on, delete the public statement, add
   CloudFront OAC (later lab). Anonymous S3 URL stays 403 on purpose.

`public-read` ACLs are not the outcome.

## Hints

### Hint 1 — RestrictPublicBuckets is the policy-killer

`BlockPublicPolicy` rejects *putting* a new public policy.
`RestrictPublicBuckets` makes an *existing* public policy not authorize
anonymous requests. You can "have" a public policy that does nothing.

### Hint 2 — Policy status vs policy document

`get-bucket-policy` shows intent. `get-bucket-policy-status` shows whether
AWS currently treats it as public. They disagree under BPA.

## Solution

If the site is meant to be a public S3 website:

```
aws s3api put-public-access-block --bucket www-example-com \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
```

Account BPA can override; check `get-public-access-block` without a bucket
(account). If security baseline forbids public buckets, do not fight BPA —
put CloudFront in front and keep the bucket private.

- **403 + a public-looking policy** is BPA until proven otherwise.
- **Do not attach IAM to anonymous users.** There are none.
- **ACLs vs policy vs BPA** are three switches; flipping all of them is
  how these tickets last a week.
