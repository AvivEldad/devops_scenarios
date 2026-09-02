# The security group is open. The VPC endpoint is not.

## Briefing

The app subnet has no NAT. S3 is reached through a gateway VPC endpoint.
Egress on the instance SG is `0.0.0.0/0` :443. NACLs are the default allow.
`aws s3 ls s3://prod-reports/` from the instance is AccessDenied. The same
role from a jump host on the public internet succeeds.

The endpoint policy was copied from a sandbox that only had `sandbox-bucket`.
Once a gateway endpoint exists, S3 traffic from this VPC that matches the
prefix list goes *through* it. The endpoint policy is another resource
policy. It is not a security group problem and it is not the four-layer
reachability lab.

## Your Task

- Show that the packet path is the gateway endpoint, not IGW/NAT.
- Read the endpoint policy and the bucket the app actually uses.
- Widen the endpoint policy to the required bucket ARNs (bucket + `/*`),
  without setting `"Action":"*" "Resource":"*"`.

## Starter Files

### file: vpc-endpoint.json

```json
{
  "VpcEndpointId": "vpce-0s3gw",
  "VpcEndpointType": "Gateway",
  "ServiceName": "com.amazonaws.eu-west-1.s3",
  "RouteTableIds": ["rtb-private"],
  "PolicyDocument": {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": "*",
        "Action": ["s3:GetObject", "s3:ListBucket"],
        "Resource": [
          "arn:aws:s3:::sandbox-bucket",
          "arn:aws:s3:::sandbox-bucket/*"
        ]
      }
    ]
  }
}
```

### file: route-table.txt

```
rtb-private  subnet-app-a
  10.50.0.0/16     local
  pl-xxxx (S3)     vpce-0s3gw
  (no 0.0.0.0/0)
```

### file: from-instance.txt

```
$ curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
app-prod-role

$ aws s3 ls s3://prod-reports/
AccessDenied

$ aws s3 ls s3://sandbox-bucket/
# (works)

# from a laptop with the same role, no VPC:
$ aws s3 ls s3://prod-reports/
# daily.csv
```

## Expected Failure

AccessDenied only inside the VPC. Identity policy allows `prod-reports`.
Endpoint policy does not list that bucket, so the gateway implicit-denies.
There is no timeout — this is IAM on the endpoint, not a dropped SYN.

## Expected Outcome

From the instance:

```
aws s3 ls s3://prod-reports/
# daily.csv
aws s3 cp s3://prod-reports/daily.csv -
```

Endpoint policy resources include `prod-reports` and `prod-reports/*`.
Sandbox bucket can stay. SG unchanged.

## Hints

### Hint 1 — Gateway endpoints steal the S3 route

A prefix-list route to `vpce-0s3gw` means you will not use NAT even if you
add one later for other APIs. Debugging "S3 AccessDenied only in this
subnet" starts with `describe-vpc-endpoints`, not `describe-security-groups`.

### Hint 2 — Principal "*" on an endpoint is not public

Endpoint policies with `Principal "*"` still only apply to callers who
arrive *through that endpoint*. They do not make the bucket public. Missing
the bucket ARN is a deny for those callers.

## Solution

Add the production bucket to the endpoint policy. Keep List on the bucket
ARN and Get on `/*`.

```json
"Resource": [
  "arn:aws:s3:::sandbox-bucket",
  "arn:aws:s3:::sandbox-bucket/*",
  "arn:aws:s3:::prod-reports",
  "arn:aws:s3:::prod-reports/*"
]
```

Restrict `Principal` to the app role if you want defence in depth.

- **Open SG ≠ authorized S3.** Different layer.
- **Interface endpoints** (Secrets Manager, STS) have SGs of their own;
  this lab is the gateway *policy*.
- **Do not delete the endpoint** "so it uses the internet" — private-only
  subnets will then time out instead of denying.
