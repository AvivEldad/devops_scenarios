# dig returns an address, curl hangs, ping6 is the thing that actually fails

## Briefing

`dig reports.internal A` is empty. `dig reports.internal AAAA` returns a
global IPv6 address. `curl http://reports.internal/` hangs, then times out.
Someone added an A record in staging and "fixed" it. Production still has only
AAAA, and that address is not routed on this VLAN.

glibc and curl try IPv6 first when an AAAA exists. A broken IPv6 path with a
working IPv4 story (or no IPv4 at all) looks like "DNS is down" or "the app is
down".

## Your Task

- Show that the name has AAAA and no usable A (or that AAAA is preferred).
- Prove the v6 next hop is the failure, not HTTP.
- Restore reachability: publish a working A, fix v6 routing, or stop advertising
  a dead AAAA.

## Starter Files

### file: names.txt

```
# what DNS currently returns for reports.internal
reports.internal.  300  IN  AAAA  2001:db8:bad:1::80
# no A record
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "== A =="; echo "(none in this incident)"
echo "== AAAA =="; echo "2001:db8:bad:1::80"
echo "== curl happy eyeballs against a documented-unroutable v6 =="
# 2001:db8::/32 is documentation space — should not route
curl -sg --connect-timeout 3 "http://[2001:db8:bad:1::80]/" || true
echo
echo "== force IPv4 (would work if an A existed) =="
curl -s4 --connect-timeout 2 http://127.0.0.1:9 || true
```

## Expected Failure

```bash
getent ahosts reports.internal
# 2001:db8:bad:1::80  STREAM reports.internal
# (no IPv4)

curl -sv --connect-timeout 3 http://reports.internal/
# * Trying 2001:db8:bad:1::80:80...
# curl: (28) Connection timed out
```

DNS "worked". The address it returned is not reachable from this network.

## Expected Outcome

Clients get an address family they can actually use:

```bash
getent ahosts reports.internal
# a working IPv4 and/or a working IPv6

curl -sS --connect-timeout 3 http://reports.internal/health
# 200
```

AAAA is not published for prefixes this site cannot route, or v6 routing is
fixed so the AAAA is true.

## Hints

### Hint 1 — Query both families

`dig A` and `dig AAAA` (or `getent ahosts`). One record type succeeding is not
"DNS is fine". Happy Eyeballs will still burn seconds on a dead AAAA before
falling back to A — and there is no fallback if A is missing.

### Hint 2 — curl -4 / ping6

`curl -6` and `ping6` test the v6 path in isolation. `curl -4` tests v4. If `-6`
times out and `-4` works, do not debug HTTP. Remove or fix the AAAA, or fix the
v6 route (`ip -6 route get`).

## Solution

Stop advertising an address you cannot deliver.

```bash
dig +short reports.internal A
dig +short reports.internal AAAA
ip -6 route get 2001:db8:bad:1::80
curl -g --connect-timeout 3 "http://[2001:db8:bad:1::80]/"

# fix: add a working A, and/or withdraw the dead AAAA
# nsupdate / terraform aws_route53_record / knet
# until then, operators can: curl -4  (workaround, not a platform fix)
```

- **AAAA without a routed v6 prefix is an outage** for dual-stack clients.
- **`dig` success is not reachability.** Dig does not send SYN.
- **Happy Eyeballs hides a slow v6 fail** when A exists; it cannot help when A
  does not.
- **Publish AAAA only where ICMPv6 and TCP to that prefix work** from the
  networks that will use the name.
