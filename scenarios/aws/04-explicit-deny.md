# Allow looks wide open. Every call is still denied.

## Briefing

CI cannot read `prod-reports`. The attached policy allows ListBucket and GetObject
on that bucket. GetObject is still AccessDenied.

Someone closed a security ticket last week by adding a Deny. Deny is not a
suggestion. If a Deny statement matches, the Allow never gets a vote.

## Your Task

- Read the policy. Identify the statement that actually decides this request.
- Explain why the simulator will say `explicitDeny` rather than `implicitDeny`.
- Fix the Deny so it still blocks the threat in the ticket, without blocking the
  CI role that is supposed to read the bucket.

## Starter Files

### file: ci-s3-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LooksOpen",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::prod-reports",
        "arn:aws:s3:::prod-reports/*"
      ]
    },
    {
      "Sid": "SEC-1841-Lockdown",
      "Effect": "Deny",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::prod-reports",
        "arn:aws:s3:::prod-reports/*"
      ],
      "Condition": {
        "StringNotEquals": {
          "aws:PrincipalTag/team": "analytics"
        }
      }
    }
  ]
}
```

### file: caller.txt

```
role: arn:aws:iam::111122223333:role/ci-reports
session tags: none
aws:PrincipalTag/team: (not set)
ticket SEC-1841: "stop random roles in this account from reading prod-reports"
```

## Expected Failure

```
aws s3 cp s3://prod-reports/daily.csv -
# An error occurred (AccessDenied) when calling the GetObject operation: Access Denied
```

```
EvalDecision: explicitDeny
MatchedStatements: SEC-1841-Lockdown
MissingContextValues: none
```

The Allow statement matches. It does not matter.

## Expected Outcome

CI can list and read `prod-reports`. Roles without `team=analytics` (and without
being this CI role) still cannot. The simulator for the CI role returns `allowed`
on `s3:GetObject` and `explicitDeny` is gone for that principal.

A Deny that is supposed to protect a bucket is scoped with a condition that
describes the *threat*, or it names the principals that must be blocked — it
does not deny everyone except a tag the caller never had.

## Hints

### Hint 1 — Evaluation order is not "first Allow wins"

IAM evaluates every applicable statement. Any matching Deny wins, always. An
Allow on `s3:*` plus a Deny on `s3:*` for the same resource is a Deny. Read the
`Effect` lines before you argue about the resource ARNs.

`implicitDeny` means nothing allowed you. `explicitDeny` means something
matched and refused you. Those two fixes are opposites.

### Hint 2 — StringNotEquals on a missing tag denies you

`StringNotEquals` is true when the tag is absent. The CI role has no
`team=analytics` tag, so SEC-1841 matches every request it makes. Tag-based
Denies are fail-closed for untagged principals, which is often what you want
for humans and almost never what you want for a dedicated CI role.

## Solution

The Allow was real. The Deny was broader than the ticket. Untagged CI was in
the Deny set.

Give CI a principal tag `team=analytics`, **or** carve CI out of the Deny,
**or** rewrite the Deny to name the principals you actually intend to block.
Do not delete the Deny and leave `s3:*` as the only control.

```json
{
  "Sid": "SEC-1841-Lockdown",
  "Effect": "Deny",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::prod-reports",
    "arn:aws:s3:::prod-reports/*"
  ],
  "Condition": {
    "StringNotEquals": {
      "aws:PrincipalArn": [
        "arn:aws:iam::111122223333:role/ci-reports",
        "arn:aws:iam::111122223333:role/analytics-readers"
      ]
    }
  }
}
```

- **Deny wins.** Stop widening Allows when the simulator already says
  `explicitDeny`.
- **Missing tags fail closed** on `StringNotEquals`.
- **Ticket-driven Denies** need a principal or a tag the caller actually has.
