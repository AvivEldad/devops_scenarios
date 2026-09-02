# Lambda in a VPC times out talking to AWS

## Briefing

The function was moved into private subnets so it could reach RDS. RDS
works. `secretsmanager:GetSecretValue` and any HTTPS call to the public
API now hit the function timeout (30s). IAM for Secrets Manager is
correct. CloudWatch shows `Task timed out after 30.00 seconds`, not
AccessDenied.

Private subnets have a local route only. There is no NAT gateway and no
interface VPC endpoint for Secrets Manager (or STS, or the third-party
API). Lambda ENIs cannot use the public service endpoints from there.
This is routing, not the RDS security-group lab and not "IAM on the
function role".

## Your Task

- From the subnet route table and the timeout (vs AccessDenied), name
  the missing hop.
- Choose NAT (egress to the internet) or VPC interface endpoints (private
  AWS APIs), or both.
- Do not "fix" it by attaching `AdministratorAccess` or by setting
  timeout to 900 seconds.

## Starter Files

### file: function.json

```json
{
  "FunctionName": "api-worker",
  "Timeout": 30,
  "Role": "arn:aws:iam::111122223333:role/api-worker",
  "VpcConfig": {
    "SubnetIds": ["subnet-priv-a", "subnet-priv-b"],
    "SecurityGroupIds": ["sg-lambda"]
  }
}
```

### file: routes.txt

```
rtb-private  subnet-priv-a, subnet-priv-b
  10.50.0.0/16   local
  # no 0.0.0.0/0
  # no vpce-... for secretsmanager, sts, logs, s3

sg-lambda  egress 0.0.0.0/0 all   # open, irrelevant without a route
sg-lambda  ingress none needed for outbound APIs
```

### file: logs.txt

```
START RequestId: ...
[INFO] connecting to prod-app.xxxx.rds.amazonaws.com:3306  # ok
[INFO] fetching secret prod/db
END RequestId: ...
REPORT  Duration: 30000.00 ms  Status: timeout
# no AccessDeniedException in the log
```

## Expected Failure

RDS queries succeed (private IP, SG already allowed). Secret fetch or
`https://example.com` hangs until Lambda kills the invocation. From a
function **without** VPC config, the same IAM GetSecretValue would work
immediately.

## Expected Outcome

GetSecretValue returns inside a second. Options that satisfy the lab:

- NAT gateway (or NAT instance) default route on `rtb-private`, **or**
- Interface endpoints for `secretsmanager`, and `logs` if you need them,
  with `sg-lambda` allowed to those endpoint SGs on 443.

RDS remains reachable. Function role IAM is unchanged. Timeout can stay
30s.

## Hints

### Hint 1 — Timeout is not IAM

AccessDenied is fast. Thirty seconds is a missing route, a dropped SYN,
or a DNS black hole. Check `VpcConfig` first when a previously working
function "only broke after we added the VPC".

### Hint 2 — S3 is a gateway endpoint; Secrets Manager is not

An S3 gateway endpoint would not fix Secrets Manager. Interface
endpoints have their own SGs; Lambda's SG must allow egress 443 to them
(or to 0.0.0.0/0 plus endpoint SG ingress from `sg-lambda`).

## Solution

Short-term: add NAT `0.0.0.0/0` on the private route table.

Better for AWS APIs only: create interface endpoints in those subnets:

```
com.amazonaws.eu-west-1.secretsmanager
com.amazonaws.eu-west-1.logs
```

Private DNS on. Endpoint SG: inbound 443 from `sg-lambda`.

Removing `VpcConfig` also restores public AWS APIs and **breaks RDS**
unless RDS is public — that is not the fix.

- **Lambda in a VPC never gets a public IP.** IGW on the VPC is not
  enough.
- **Cold starts plus ENI** are a latency story; they are not a 30s hang
  on GetSecretValue.
- **Do not raise the timeout** to hide a blackholed route.
