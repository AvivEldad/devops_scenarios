# The vendor cannot assume the role without ExternalId

## Briefing

A SaaS backup vendor is supposed to assume `role/vendor-backup` in your
account. Their dashboard shows `AccessDenied` on `sts:AssumeRole`. Your
trust policy allows their account principal. You already confirmed this
is not "CI user missing sts:AssumeRole" — there is no identity policy
needed on *their* side inside *your* account beyond trust.

They send `ExternalId=prod-acme-9921` as documented. The trust policy
has no `sts:ExternalId` condition, **or** it still has last quarter's
staging id. Either the assume is denied because the condition does not
match, or — if the condition is missing — the role is assumable by
anyone in a position to use that vendor account (confused-deputy
cousin). This lab stays on ExternalId, not SourceArn.

## Your Task

- Read the vendor's AssumeRole parameters and the trust `Condition`.
- Put `sts:ExternalId` on the trust with the **production** value from
  the vendor console.
- Give the vendor only that external ID through their UI — do not reuse
  it on another customer role.

## Starter Files

### file: trust-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::999988887777:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "staging-acme-001"
        }
      }
    }
  ]
}
```

### file: vendor-request.json

```json
{
  "roleArn": "arn:aws:iam::111122223333:role/vendor-backup",
  "roleSessionName": "acme-prod-backup",
  "externalId": "prod-acme-9921",
  "vendorAccount": "999988887777"
}
```

### file: cloudtrail.json

```json
{
  "eventName": "AssumeRole",
  "errorCode": "AccessDenied",
  "userIdentity": {
    "accountId": "999988887777",
    "arn": "arn:aws:sts::999988887777:assumed-role/saas-orchestrator/job"
  },
  "requestParameters": {
    "roleArn": "arn:aws:iam::111122223333:role/vendor-backup",
    "roleSessionName": "acme-prod-backup",
    "externalId": "prod-acme-9921"
  }
}
```

## Expected Failure

```
# as the vendor
aws sts assume-role \
  --role-arn arn:aws:iam::111122223333:role/vendor-backup \
  --role-session-name acme-prod-backup \
  --external-id prod-acme-9921
# AccessDenied
```

Trust principal is correct (`999988887777`). ExternalId in the condition
is `staging-acme-001`. StringEquals does not match. Without
`--external-id`, assume would also fail (condition required).

## Expected Outcome

Vendor AssumeRole with `prod-acme-9921` succeeds. AssumeRole from that
account **without** the matching ExternalId is denied. Trust principal
stays the vendor account — not `"*"`. Your identity policy on the role
(S3 backup actions) is unchanged.

## Hints

### Hint 1 — ExternalId is a shared secret in the trust condition

It is not a permission on an identity policy. The vendor must send the
same string you put in `sts:ExternalId`. Staging vs prod IDs are a
classic mismatch after a cutover.

### Hint 2 — Why it exists

If several customers trust `999988887777:root`, a customer who learns
*your role ARN* could ask the vendor (or a confused workflow) to assume
**your** role. ExternalId is the per-customer string the vendor is
willing to send only for your tenant. It is not encryption; it is an
IAM condition. Do not publish it in a public ticket.

## Solution

```json
"Condition": {
  "StringEquals": {
    "sts:ExternalId": "prod-acme-9921"
  }
}
```

Remove the staging id. Confirm the vendor console has the same value.
Rotate the ExternalId if it was pasted in Slack.

- **Missing ExternalId entirely** is the insecure variant: assume works
  and Access Analyzer should complain. Add the condition even if the
  vendor currently succeeds.
- **Lab 22** is service SourceArn. **Lab 03** is your CI user vs trust.
  This is only `sts:ExternalId`.
- **Do not use the same ExternalId** on two roles in two accounts.
