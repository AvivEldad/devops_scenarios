# The database times out on 3306. The instance is fine.

## Briefing

The API host is `running`, `2/2` status checks, and serves HTTP to the
ALB. It cannot open a TCP connection to RDS:

```
ERROR 2003 (HY000): Can't connect to MySQL server on
'prod-app.xxxx.eu-west-1.rds.amazonaws.com:3306' (110 - Connection timed out)
```

RDS is `available`. Security groups were "copied" during an ECS-to-EC2
migration: the database SG still allows `sg-ecs-tasks` on 3306. The API
instances use `sg-api`. This is not SSH to the instance and not the
four-layer public-path lab. It is one inbound rule on the *database* ENI.

## Your Task

- Name which SG must allow 3306, and which SG must be the *source*.
- Explain why a timeout (not "access denied" from MySQL) is the symptom.
- Allow `sg-api` on the RDS SG for 3306, without `0.0.0.0/0`.

## Starter Files

### file: rds.json

```json
{
  "DBInstanceIdentifier": "prod-app",
  "Endpoint": {
    "Address": "prod-app.xxxx.eu-west-1.rds.amazonaws.com",
    "Port": 3306
  },
  "VpcSecurityGroups": [{ "VpcSecurityGroupId": "sg-db", "Status": "active" }],
  "DBInstanceStatus": "available",
  "PubliclyAccessible": false
}
```

### file: sg-db.json

```json
{
  "GroupId": "sg-db",
  "IpPermissions": [
    {
      "IpProtocol": "tcp",
      "FromPort": 3306,
      "ToPort": 3306,
      "UserIdGroupPairs": [
        { "GroupId": "sg-ecs-tasks", "Description": "old ecs service" }
      ]
    }
  ]
}
```

### file: api-instance.txt

```
i-api-1  groups: sg-api, sg-shared-base
# sg-api: inbound 8080 from sg-alb; outbound all
# the API process binds 8080. it is a *client* of RDS, not a listener on 3306.

$ nc -vz prod-app.xxxx.eu-west-1.rds.amazonaws.com 3306
# Connection timed out
```

## Expected Failure

HTTP to the API from the ALB works. Outbound 3306 from the API times out.
RDS logs show no connection. MySQL auth is never reached. `sg-ecs-tasks`
is attached to nothing that still runs.

## Expected Outcome

```
nc -vz prod-app.xxxx.eu-west-1.rds.amazonaws.com 3306
# succeeded
```

The app connects with the existing DB user. `sg-db` inbound 3306 source is
`sg-api` (ecs group may remain during drain). Not `0.0.0.0/0`, not a public
RDS flip.

## Hints

### Hint 1 — Clients do not need 3306 inbound on themselves

The SYN is from the API ENI to the RDS ENI. The filter that matters is
**inbound on `sg-db`**. Opening 3306 on `sg-api` does nothing for this
timeout.

### Hint 2 — Timeout means the SYN died, AccessDenied would be later

SG drop = timeout (110). Wrong password = a MySQL error. Wrong VPC /
different subnet without routes = also timeout — check `describe-db-instances`
`DBSubnetGroup` vs the API subnet, but here the leftover SG id is enough.

## Solution

Authorize the live app group on the database group:

```
aws ec2 authorize-security-group-ingress --group-id sg-db \
  --protocol tcp --port 3306 --source-group sg-api
```

Remove `sg-ecs-tasks` when the old service is gone so the rule does not
silently resurrect.

- **RDS has its own ENI and SG.** "The instance SG is open" is the wrong
  object.
- **Do not set PubliclyAccessible** to debug a private timeout.
- **Source is the client SG id**, not the RDS SG self-reference, unless
  the app literally shares `sg-db` (it should not).
