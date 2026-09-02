# The ban hammer hit the load balancer, and attackers still get through

## Briefing

The WAF and the app both trust `X-Forwarded-For`. Last week's incident
response banned `203.0.113.50`. The attacker set `X-Forwarded-For:
1.2.3.4` and kept calling the API. Meanwhile a legitimate user behind a
CGNAT was banned because the app logged the LB's private IP as the client
and someone blocked `10.4.0.12` — every tenant behind that LB.

The TCP source IP is the only field the client cannot easily spoof on a
normal HTTPS connection. Everything in HTTP headers is a claim. You may
honour XFF only from hops you own, and you must take the right address
from the chain.

## Your Task

- Show that a client can send an arbitrary `X-Forwarded-For`.
- Configure the reverse proxy to set (or overwrite) the header from the
  real peer, or use a trusted hop count.
- Confirm application logs show the TCP client IP (or the address your
  proxy appended), not the spoofed value.

## Starter Files

### file: spoof.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# the app currently treats the first XFF hop as gospel
curl -sv https://api.example/whoami \
  -H 'X-Forwarded-For: 1.2.3.4' \
  -H 'X-Real-IP: 1.2.3.4' || true
```

### file: nginx.broken.conf

```
# passes client headers through — attacker-controlled
proxy_pass http://app;
# missing:
#   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#   realip: set_real_ip_from 10.4.0.0/16; real_ip_header X-Forwarded-For;
```

## Expected Failure

```bash
bash spoof.sh
# GET /whoami -> {"ip":"1.2.3.4"}     # attacker-chosen
# audit log banned 1.2.3.4; real TCP peer was 198.51.100.20
```

Or the opposite: `{"ip":"10.4.0.12"}` for every user (the LB), so bans are
fleet-wide.

## Expected Outcome

```bash
curl -sS https://api.example/whoami -H 'X-Forwarded-For: 1.2.3.4'
# {"ip":"198.51.100.20"}    # TCP peer or last untrusted hop stripped
```

WAF and app use `set_real_ip_from` / `X-Forwarded-For` append from trusted
proxies only. Spoofed headers from the internet are ignored.

## Hints

### Hint 1 — Headers are not authentication

Any client can send `X-Forwarded-For`. Honour it only from CIDRs of *your*
LBs (`set_real_ip_from`, AWS ALB HTTP headers, GCP `X-Forwarded-For`
after the connecting hop).

### Hint 2 — Append, do not blindly replace from the client

`$proxy_add_x_forwarded_for` appends the real peer. If you copy the
incoming header unchanged, you are logging the attacker. If you always
log `$remote_addr` without `real_ip`, you log the LB.

## Solution

Trust topology, then pick the right hop.

```nginx
set_real_ip_from 10.4.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

- **The TCP source is the only untrusted-client-proof field** on a
  connection you terminate.
- **Ban lists on spoofable headers do not ban attackers.**
- **Ban lists on the LB address ban everyone.**
- **Document the hop count** (ALB + nginx + app) so `real_ip_recursive`
  strips the right number of append-only hops.
