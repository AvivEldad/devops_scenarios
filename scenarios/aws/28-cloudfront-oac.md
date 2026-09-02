# CloudFront 403: leftover OAI, new OAC

## Briefing

The distribution was migrated to Origin Access Control. The S3 origin
is private (BPA on — good). Every path returns 403 from CloudFront.
The bucket policy still names the canonical user of an Origin Access
Identity that was deleted in the same change window.

OAC signs requests as the CloudFront *service* with a condition on the
distribution ARN. OAI used a special CanonicalUser principal. Mixing
them is a 403 that looks like "S3 is blocked" and like "CloudFront is
misconfigured" at the same time.

## Your Task

- Read the distribution origin (OAC vs OAI) and the bucket policy
  Principal.
- Explain why an admin `GetObject` can work while CloudFront cannot.
- Replace the OAI statement with an OAC statement pinned to this
  distribution. Do not disable BPA.

## Starter Files

### file: distribution-origin.json

```json
{
  "Id": "S3-www-example-com",
  "DomainName": "www-example-com.s3.eu-west-1.amazonaws.com",
  "S3OriginConfig": { "OriginAccessIdentity": "" },
  "OriginAccessControlId": "E123OACNEW",
  "OriginAccessControl": {
    "SigningBehavior": "always",
    "SigningProtocol": "sigv4",
    "OriginAccessControlOriginType": "s3"
  }
}
```

### file: bucket-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLegacyOAI",
      "Effect": "Allow",
      "Principal": {
        "CanonicalUser": "64a379496658eadb5408101537ed480287795685f91a32e05f8d23022bfb10a1"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::www-example-com/*"
    }
  ]
}
```

### file: curl.txt

```
curl -si https://d111111abcdef8.cloudfront.net/index.html
# HTTP/1.1 403 Forbidden
# x-cache: Error from cloudfront
# <Code>AccessDenied</Code>

aws s3 cp s3://www-example-com/index.html -   # as admin: works
curl -si https://www-example-com.s3.eu-west-1.amazonaws.com/index.html
# 403  (anonymous — expected with BPA)
```

## Expected Failure

CloudFront 403. S3 access logs / CloudTrail GetObject from
`cloudfront.amazonaws.com` AccessDenied. The CanonicalUser in the
policy no longer exists as an OAI on the distribution (`OriginAccessIdentity`
is empty). OAC is signing; the bucket does not allow that principal.

## Expected Outcome

```
curl -sS -o /dev/null -w "%{http_code}\n" https://d111111abcdef8.cloudfront.net/index.html
# 200
```

Bucket policy Principal is `cloudfront.amazonaws.com` with
`AWS:SourceArn` of this distribution. BPA stays on. Anonymous S3 URL
stays 403. No public `Principal "*"`.

## Hints

### Hint 1 — Empty OriginAccessIdentity plus OAC id means OAC

Do not add the OAI back "because the policy mentions CanonicalUser".
Match the policy to the origin's current access control.

### Hint 2 — SourceArn is the distribution, not the bucket

`arn:aws:cloudfront::111122223333:distribution/E123DIST`. Wrong account
or a `*` distribution ARN is either still-broken or overly broad.

## Solution

```json
{
  "Sid": "AllowCloudFrontOAC",
  "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::www-example-com/*",
  "Condition": {
    "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::111122223333:distribution/E123DIST"
    }
  }
}
```

Delete `AllowLegacyOAI`. Wait for CloudFront + S3 policy to propagate
(seconds to minutes).

- **OAI and OAC are not interchangeable principals.**
- **403 from CloudFront with 200 from admin S3** is origin auth, not
  your SPA routing, until proven otherwise.
- **Do not set the bucket public** to "test CloudFront".
