# You are admin. The organisation is not.

## Briefing

The member account's IAM identity is `AdministratorAccess`. Root in this
account is equally refused. `s3:PutBucketPolicy` and `ec2:CreateVpc` fail
with AccessDenied. There is no permissions boundary. The bucket policy is
empty.

The organisation attached an SCP that looks like a reasonable guardrail:
deny leaving `eu-west-1`, deny disabling CloudTrail, deny attaching
`AdministratorAccess` to anyone else. One of the statements also denies
the API you are calling. IAM in the account cannot override an SCP.

## Your Task

- From the SCP and the CloudTrail event, show that identity is not the
  layer that denied you.
- Name whether this is explicit Deny in the SCP or an SCP that does not
  *allow* the action (implicit).
- Say what has to change (org management account / SCP), and what you
  must not do (widen IAM in the member account).

## Starter Files

### file: identity.txt

```
arn:aws:iam::111122223333:user/admin
attached: arn:aws:iam::aws:policy/AdministratorAccess
PermissionsBoundary: none
Account 111122223333 is in ou=workloads under o-abc
```

### file: scp-workloads.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyOutsideEU",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["eu-west-1", "eu-central-1"]
        }
      }
    },
    {
      "Sid": "NoNewInternet",
      "Effect": "Deny",
      "Action": [
        "ec2:CreateInternetGateway",
        "ec2:AttachInternetGateway",
        "ec2:CreateVpc",
        "ec2:CreateNatGateway"
      ],
      "Resource": "*"
    },
    {
      "Sid": "NoPublicBuckets",
      "Effect": "Deny",
      "Action": ["s3:PutBucketPolicy", "s3:PutBucketPublicAccessBlock"],
      "Resource": "*"
    }
  ]
}
```

### file: cloudtrail.json

```json
{
  "eventName": "CreateVpc",
  "awsRegion": "eu-west-1",
  "errorCode": "Client.UnauthorizedOperation",
  "errorMessage": "You are not authorized to perform this operation.",
  "userIdentity": { "arn": "arn:aws:iam::111122223333:user/admin" }
}
```

## Expected Failure

```
aws ec2 create-vpc --cidr-block 10.80.0.0/16 --region eu-west-1
# UnauthorizedOperation

aws s3api put-bucket-policy --bucket prod-reports --policy file://p.json
# AccessDenied
```

`simulate-principal-policy` in the member account may still show `allowed`
for those actions — it does not evaluate SCPs. That is the trap.

## Expected Outcome

You can state: member IAM is sufficient; SCP `NoNewInternet` /
`NoPublicBuckets` is the deny. The change request goes to the org
management account (exception OU, or a narrower SCP). Attaching another
admin policy in the member account changes nothing.

If the work is legitimate, the org grants a break-glass OU or edits the
SCP action list — not `iam:CreatePolicy` in the child.

## Hints

### Hint 1 — Root in a member account is still under the SCP

SCPs do not apply to the management account. They do apply to member root.
"I am admin" is not a diagnosis in an organisation.

### Hint 2 — FullAWSAccess is an Allow that must stay attached

SCPs are Allow-lists unless you only use Deny statements. A Deny SCP plus
the default `FullAWSAccess` Allow is the usual model. Removing
`FullAWSAccess` from the OU makes everything implicit deny. Here the
default Allow is present; the extra Deny statements are what bite.

## Solution

Stop editing IAM in `111122223333`. Read Organizations: list SCPs on the
account and its OUs.

`CreateVpc` matches `NoNewInternet`. `PutBucketPolicy` matches
`NoPublicBuckets`. Region is `eu-west-1`, so `DenyOutsideEU` is not this
incident — but it would be if you had used `us-east-1`.

- **IAM cannot override SCP.** That is the point of SCP.
- **Simulator in the member account will lie** by not seeing the org.
- **Do not disable the org, detach the account, or punch `Action":"*"`
  Allows into the SCP** to get a VPC. Ask for a controlled exception.
