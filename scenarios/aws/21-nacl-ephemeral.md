# NACL allows 443 in. The reply never comes back.

## Briefing

Custom network ACLs were added "to be stricter than security groups".
Inbound 443 from `0.0.0.0/0` is allowed. Outbound 443 is allowed. HTTPS
from a client in this subnet to the internet times out. HTTPS *to* an
instance in this subnet also times out after the handshake tries to
return.

Security groups are stateful: an allowed inbound SYN permits the return.
NACLs are not. The ephemeral ports (typically 1024–65535) that carry the
reply were never allowed. This is a single-layer NACL mistake, not the
four-layer "instance nobody can reach" lab — SG, route, and IGW are
already correct.

## Your Task

- From the NACL entries, show that 443 is allowed and ephemeral return is
  not.
- Explain timeout vs the SG (which already allows 443).
- Add the ephemeral range in the correct direction without `allow all`
  on both directions as the first and only rule.

## Starter Files

### file: nacl.txt

```
acl-custom  subnet-web  (not the VPC default NACL)

Rule  In/Out  Proto  Port        CIDR         Allow/Deny
100   inbound tcp    443         0.0.0.0/0    ALLOW
110   inbound tcp    22          10.0.0.0/8   ALLOW
*     inbound all    all         0.0.0.0/0    DENY

100   outbound tcp   443         0.0.0.0/0    ALLOW
*     outbound all   all         0.0.0.0/0    DENY
```

### file: sg-web.txt

```
sg-web  inbound tcp 443  0.0.0.0/0
sg-web  outbound all
# stateful: return traffic for an allowed flow is permitted on the SG
```

### file: symptoms.txt

```
# browser → instance:443  (SYN arrives; SYN-ACK uses src 443 dst ephemeral)
curl -sv --connect-timeout 5 https://ec2-xx.eu-west-1.compute.amazonaws.com/
# Connection timed out

# instance → https://sts.eu-west-1.amazonaws.com/
# outbound SYN dst 443 ok; inbound reply dst ephemeral dropped by NACL
```

## Expected Failure

Timeouts both to and from the subnet on TCP 443. Packet captures on the
instance can show SYN-ACK leaving and never getting an ACK, or leaving
SYN and never seeing SYN-ACK, depending on direction. SG rule counters
are not the useful signal; NACL rule counters on the `*` DENY are.

## Expected Outcome

HTTPS to the instance completes. Outbound HTTPS from the instance
completes. NACL still denies unlisted ports. Ephemeral **inbound**
1024–65535 (and **outbound** 1024–65535 if this subnet *serves* 443) are
allowed. Default NACL "allow all" is not required.

## Hints

### Hint 1 — Match the return packet, not the service name

Server: inbound dest 443, outbound dest ephemeral. Client: outbound dest
443, inbound dest ephemeral. Allowing "443 both ways" is the service
port twice, not the return path.

### Hint 2 — Rule number `*` is implicit deny

Custom NACLs start closed. Copying only "our app ports" from a wiki
always forgets ephemerals. Default NACL is allow; replacing it is how
this ships.

## Solution

For a **web server** subnet:

```
inbound  100 tcp 443        0.0.0.0/0 ALLOW
outbound 100 tcp 1024-65535 0.0.0.0/0 ALLOW   # SYN-ACK / data back to clients
```

For a **client** subnet (the instance fetching APIs):

```
outbound 100 tcp 443        0.0.0.0/0 ALLOW
inbound  100 tcp 1024-65535 0.0.0.0/0 ALLOW   # replies
```

This subnet does both, so it needs both pairs. Many teams also allow
outbound 443 plus inbound ephemeral, and inbound 443 plus outbound
ephemeral.

- **SG green, NACL red** is a classic timeout with a "wide open" SG.
- **Do not open 0–65535 inbound** as a substitute for thinking — if you
  do that, the custom NACL is theatre.
- **Lab 02** stacked SG+NACL+route+IGW. Here only ephemeral NACL is
  wrong.
