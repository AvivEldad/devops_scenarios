# Public DNS has the right answer and the office still hits the old private IP

## Briefing

You cut `app.example.com` from `10.4.12.80` (legacy on-prem) to a CloudFront
or public ALB. `dig @8.8.8.8 app.example.com` shows the new addresses. Inside
the office, `dig app.example.com` still returns `10.4.12.80`. The internal
Windows DNS / BIND view / Route 53 private hosted zone is split-horizon: the
same qname has a different RRset on the internal view.

The public record is not what office resolvers use. Lowering public TTL does
nothing to a private zone that still has the old A.

## Your Task

- Query the same name at a public resolver and at the office resolver.
- Show they disagree.
- Update the *internal* view (or remove the private override) so office
  clients get the intended target.

## Starter Files

### file: views.txt

```
# public (authoritative on ns-xxx.awsdns)
app.example.com.  60  IN  A     203.0.113.10
app.example.com.  60  IN  A     203.0.113.11

# office resolver (internal view / private hosted zone)
app.example.com.  300 IN  A     10.4.12.80
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
NAME="${1:-app.example.com}"
echo "== public =="
dig +short "$NAME" @1.1.1.1 || true
echo "== configured stub (office) =="
dig +short "$NAME" || true
echo "== who answered? =="
dig "$NAME" | grep -E '^;; SERVER:|status:'
```

## Expected Failure

```bash
dig +short app.example.com @1.1.1.1
# 203.0.113.10

dig +short app.example.com
# 10.4.12.80

curl -sv --connect-timeout 3 https://app.example.com/
# Trying 10.4.12.80 — connection refused (box decommissioned)
```

Two correct answers to two different questions. The office asked the
internal view.

## Expected Outcome

```bash
dig +short app.example.com
# 203.0.113.10
# (or a new internal target you actually meant)

curl -sSI --connect-timeout 5 https://app.example.com/health
# HTTP/2 200
```

Private hosted zone / BIND view updated or deleted. Stub caches flushed.

## Hints

### Hint 1 — Always say which resolver

`dig @1.1.1.1` vs `dig @10.0.0.53` vs `dig` (whatever is in resolv.conf).
Split horizon is working as designed when those differ. It is an outage
when the internal RRset is stale.

### Hint 2 — Cloud private zones attach to VPCs, not to "DNS globally"

Route 53 private hosted zones override public names inside associated VPCs
and on-prem via inbound endpoints. Updating only the public zone leaves
every associated VPC on the old private A.

## Solution

Change the view the client actually uses.

```bash
dig +short app.example.com @1.1.1.1
dig +short app.example.com @10.0.0.53
# update private hosted zone / named view "internal"
# or: delete the private record so recursion falls through to public
resolvectl flush-caches
```

- **Same qname, two RRsets** is split DNS. Diagnose with `@resolver`.
- **Public TTL is irrelevant** to a private zone that still answers.
- **VPCs and offices often share the private view** — one stale A is a
  fleet outage.
- **After deleting a private record**, flush; negative/positive cache still
  applies on the resolver.
