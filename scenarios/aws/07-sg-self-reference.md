# The security group allows itself, and the instances are not in it

## Briefing

East-west HTTP between the API boxes times out. The security group `sg-app`
allows TCP 8080 from `sg-app`. That is the usual "talk to my peers" pattern.
The launch template was updated last month to attach `sg-shared-base` for SSM.
Nobody moved the app rule onto that group, and nobody put the instances back
into `sg-app`.

This is not the four-layer "instance nobody can reach" lab. NACL, route table
and IGW are fine. One SG rule points at a group the ENI does not have.

## Your Task

- From the instance NIC and the SG rules, say which group the 8080 rule
  actually matches.
- Explain why a self-referential rule does nothing for instances that are
  only in a different group.
- Attach the right group (or retarget the rule) so API peers can reach :8080,
  without opening 8080 to the world.

## Starter Files

### file: instance-nics.txt

```
i-api-1  10.50.1.11  groups: sg-shared-base (sg-0aaa)
i-api-2  10.50.1.22  groups: sg-shared-base (sg-0aaa)
# launch template networkInterfaces.groups = ["sg-shared-base"]
```

### file: sg-app.json

```json
{
  "GroupId": "sg-0bbb",
  "GroupName": "sg-app",
  "IpPermissions": [
    {
      "IpProtocol": "tcp",
      "FromPort": 8080,
      "ToPort": 8080,
      "UserIdGroupPairs": [
        { "GroupId": "sg-0bbb", "Description": "peers in sg-app" }
      ]
    }
  ]
}
```

### file: sg-shared-base.json

```json
{
  "GroupId": "sg-0aaa",
  "GroupName": "sg-shared-base",
  "IpPermissions": [
    {
      "IpProtocol": "tcp",
      "FromPort": 443,
      "ToPort": 443,
      "IpRanges": [{ "CidrIp": "10.50.0.0/16" }]
    }
  ]
}
```

## Expected Failure

```
curl -sv --connect-timeout 3 http://10.50.1.22:8080/health
# * Trying 10.50.1.22:8080...
# curl: (28) Connection timed out
```

ss on the target shows `8080` listening. Security group for the *source* ENI
is `sg-0aaa`. The only 8080 allow is "from `sg-0bbb`". Source is not in
`sg-0bbb`, so the packet is dropped. Timeout, not connection refused.

## Expected Outcome

Both API instances have `sg-app` (they may also keep `sg-shared-base`).
Peer curl to `:8080/health` returns 200. Ingress is still sourced from the
app SG, not `0.0.0.0/0`.

## Hints

### Hint 1 — Self-reference matches membership, not the name you intended

An inbound rule `tcp/8080 from sg-0bbb` allows clients whose **ENI is in
`sg-0bbb`**. It does not mean "anyone we think of as the app". If the
instances were never associated with that group, the rule never matches.

### Hint 2 — Timeout plus a listener is SG/NACL, not the process

`ss -lnt sport = :8080` on the destination plus a client timeout means the
SYN died in a filter. Here the NACL is not the story: `describe-instances`
vs `describe-security-groups` is.

## Solution

Put the instances back in `sg-app`, or add 8080 on `sg-shared-base` from
`sg-shared-base` if that group is now the peer identity. Two groups on one
ENI is normal.

```
# attach sg-app without dropping SSM/base
aws ec2 modify-instance-attribute --instance-id i-api-1 \
  --groups sg-0aaa sg-0bbb
aws ec2 modify-instance-attribute --instance-id i-api-2 \
  --groups sg-0aaa sg-0bbb
```

- **SG id in a rule is the source identity**, not a comment.
- **Launch template drift** (base SG only) is how this ships to prod.
- **Do not "fix" it with `0.0.0.0/0:8080`.** Restore the peer group.
