# You updated IAM. Nobody updated the resource policy.

## Briefing

Account B should `SendMessage` to a queue in account A. B's role now has
`sqs:SendMessage` on the queue ARN. The send is still AccessDenied.
Someone "finished" the ticket on the identity side.

Cross-account access to SQS (and S3, and KMS, and Secrets) requires
**both** an identity Allow in the caller account **and** a resource
Allow in the owning account. Same-account SQS often works with identity
alone, which is why this pattern is learned too late. Only one side was
updated. This is not the KMS two-party CMK lab and not a Deny in a
bucket policy — the resource policy is still the default, which names
nobody in B.

## Your Task

- Say which document lives in A and which lives in B.
- Show that identity simulation in B can say `allowed` while the API
  denies.
- Add B's role to the queue policy (the missing side). Do not set
  `Principal "*"` on the queue.

## Starter Files

### file: account-b-identity.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendToA",
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:eu-west-1:111122223333:ingest"
    }
  ]
}
```

### file: account-a-queue-policy.json

```json
{
  "Version": "2012-10-17",
  "Id": "arn:aws:sqs:eu-west-1:111122223333:ingest/SQSDefaultPolicy",
  "Statement": [
    {
      "Sid": "OwnerOnly",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
      "Action": "SQS:*",
      "Resource": "arn:aws:sqs:eu-west-1:111122223333:ingest"
    }
  ]
}
```

### file: error.txt

```
# from 444455556666 role/producer
aws sqs send-message --queue-url https://sqs.eu-west-1.amazonaws.com/111122223333/ingest \
  --message-body '{"id":1}'
# AccessDenied: User: arn:aws:sts::444455556666:assumed-role/producer/job
# is not authorized to perform: sqs:SendMessage on resource
# arn:aws:sqs:eu-west-1:111122223333:ingest because no resource-based policy
# allows the sqs:SendMessage action
```

## Expected Failure

SendMessage from B denied. SendMessage from a role in A succeeds. B's
IAM looks complete. Queue policy `Principal` is only A's root. The error
here *does* mention resource-based policy — believe it.

The same shape for S3 is "bucket policy never got the other account";
for KMS, "key policy never got the other account". You only need to fix
the side that is still default.

## Expected Outcome

```
aws sqs send-message --queue-url ... --message-body '{"id":1}'
# MessageId: ...
```

Queue policy allows `arn:aws:iam::444455556666:role/producer` to
`SendMessage` (and `GetQueueUrl` if they resolve by name). B's identity
policy stays. No public queue.

## Hints

### Hint 1 — Same-account vs cross-account

Same account: identity Allow is usually enough for SQS/S3 (unless a
resource Deny exists). Cross-account: resource policy is mandatory. The
mental model "we attached the policy to the role" is only half.

### Hint 2 — Who can edit which document

B cannot put a queue policy on A's queue. The ticket must be worked in
**both** accounts. If you only have access to B, the remaining deny is
not yours to IAM-away.

## Solution

In account A:

```json
{
  "Sid": "AllowBProducer",
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::444455556666:role/producer" },
  "Action": ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"],
  "Resource": "arn:aws:sqs:eu-west-1:111122223333:ingest"
}
```

Keep `OwnerOnly` for A. Condition on `aws:SourceAccount` /
encryption if the queue uses SSE-KMS (then you also need the CMK
two-party grants).

- **Identity ∩ resource**, then minus Deny. Cross-account with only one
  side updated is implicit deny from the missing side.
- **KMS-encrypted queues** add a fourth document (key policy) — do not
  confuse with "SQS policy was enough".
- **Do not copy B's AdministratorAccess into A.** Name the producer
  role.
