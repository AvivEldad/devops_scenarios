# GetSecretValue denied by a policy you did not attach to the role

## Briefing

The task role has `secretsmanager:GetSecretValue` on the secret ARN. The
call still returns AccessDenied. There is no SCP story this week.

The secret has a resource policy leftover from a cross-account sharing
experiment. Resource policies on secrets are evaluated with identity
policies. An explicit Deny, or an Allow-list that does not include this
role, blocks GetSecretValue even when IAM looks perfect.

This is the Secrets Manager version of "identity allows, resource policy
does not" — not KMS, not S3 ARNs.

## Your Task

- Read both the identity statement and `get-resource-policy` on the secret.
- Decide if you are looking at an explicit Deny or a resource Allow that
  omits this principal (cross-account needs both sides).
- Fix the secret policy so this role can read, without `Principal "*"` on
  the secret.

## Starter Files

### file: identity-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:eu-west-1:111122223333:secret:prod/db-AbCdEf"
    }
  ]
}
```

### file: secret-resource-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OnlyTheOldLambda",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111122223333:role/rotate-db-legacy"
      },
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "*"
    },
    {
      "Sid": "DenyEveryoneElse",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "secretsmanager:*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:PrincipalArn": "arn:aws:iam::111122223333:role/rotate-db-legacy"
        }
      }
    }
  ]
}
```

### file: error.txt

```
aws secretsmanager get-secret-value --secret-id prod/db --region eu-west-1
# AccessDeniedException: User: arn:aws:sts::111122223333:assumed-role/api-task/task
# is not authorized to perform: secretsmanager:GetSecretValue
# on resource: prod/db because no identity-based policy allows the
# secretsmanager:GetSecretValue action
```

## Expected Failure

GetSecretValue AccessDenied for `api-task`. `rotate-db-legacy` still works.
The CLI message may blame identity-based policy even when a resource Deny
is the match — do not trust the prose, trust the two documents.

Same-account: identity Allow would be enough **without** the Deny
statement. The Deny is what makes the identity policy look "ignored".

## Expected Outcome

`api-task` can GetSecretValue. `rotate-db-legacy` still can. No
`Principal "*" Allow`. The Deny, if kept, lists both roles (or is removed
and the Allow statement names both).

## Hints

### Hint 1 — Secrets have resource policies

`aws secretsmanager get-resource-policy --secret-id prod/db`. Empty policy
means identity-only (same account). Non-empty Deny is the first thing to
read after an unexpected AccessDenied.

### Hint 2 — The error text lies

Secrets Manager often says "no identity-based policy allows" when a
resource Deny matched. You already have an identity Allow. Keep reading.

## Solution

Add the runtime role next to the rotator; stop denying the world minus one:

```json
{
  "Sid": "Readers",
  "Effect": "Allow",
  "Principal": {
    "AWS": [
      "arn:aws:iam::111122223333:role/rotate-db-legacy",
      "arn:aws:iam::111122223333:role/api-task"
    ]
  },
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "*"
}
```

Delete `DenyEveryoneElse` unless you still need a quarantine. If KMS still
fails after this, the secret's CMK is a different lab.

- **Identity Allow + resource Deny = Deny.**
- **Cross-account GetSecretValue** needs identity in the caller account
  *and* a resource Allow for that principal — both, always.
- **Do not put the secret value in env** to "workaround" IAM.
