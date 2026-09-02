# I updated the A record five minutes ago and this box still hits the old IP

## Briefing

Route 53 (or BIND) shows `api.internal` → `10.4.20.9`. The cutover was at 10:00.
One jump host still curls `10.4.20.8` — the previous target, now powered off.
`dig @8.8.8.8` is not relevant; this name is internal. `dig @10.0.0.53` already
returns the new address. The jump host does not.

Something on the jump host is answering from a cache with a long TTL, or from
`/etc/hosts`, and the operator is about to lower the zone TTL "to fix DNS"
while the box never asked the zone.

## Your Task

- Show the stub resolver answer vs the upstream recursive answer.
- Find the cache (`systemd-resolved`, `nscd`, `dnsmasq`, `/etc/hosts`).
- Flush it (or remove the hosts override) and curl the new IP.

## Starter Files

### file: hosts.fragment

```
10.4.20.8  api.internal
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "nsswitch hosts line (typical):"
echo "hosts: files dns"
echo
echo "getent uses nsswitch — files win over DNS:"
getent ahostsv4 api.internal 2>/dev/null || echo "not in this lab hosts file"
echo
echo "dig bypasses nsswitch and talks to a nameserver:"
echo "dig +short api.internal @10.0.0.53   # would already show 10.4.20.9"
```

## Expected Failure

```bash
getent hosts api.internal
# 10.4.20.8   api.internal          <- files or a stub cache

dig +short api.internal @10.0.0.53
# 10.4.20.9                         <- zone is already correct

curl -sv --connect-timeout 2 http://api.internal/health
# Trying 10.4.20.8 — connection refused / timeout
```

`dig` and the application are not using the same lookup path.

## Expected Outcome

Every lookup path agrees on the new address:

```bash
getent hosts api.internal
# 10.4.20.9

curl -sS --connect-timeout 3 http://api.internal/health
# 200
```

`/etc/hosts` has no stale override. Stub caches were flushed.

## Hints

### Hint 1 — dig is not getent

`dig` queries a nameserver directly. `curl`, `getent`, and most binaries use
NSS (`files` then `dns`, plus `resolved`). A correct `dig` and a wrong `curl`
means hosts, nscd, or systemd-resolved — not the zone.

### Hint 2 — Flush the stub, not the internet

`resolvectl flush-caches` (or `systemd-resolve --flush-caches`),
`nscd -i hosts`, restart `dnsmasq`. TTL on the zone only matters after the
local override is gone. Check `getent hosts` before changing Route 53 again.

## Solution

Align NSS with the zone.

```bash
grep api.internal /etc/hosts          # remove the 10.4.20.8 line
getent hosts api.internal
resolvectl query api.internal
sudo resolvectl flush-caches
sudo nscd -i hosts 2>/dev/null || true
# then:
getent hosts api.internal             # 10.4.20.9
```

- **Applications do not call `dig`.** They call `getaddrinfo`.
- **`files` in nsswitch beats DNS.** `/etc/hosts` is a silent override.
- **Stub caches keep old TTLs.** Flush the box you are standing on.
- **Lowering TTL is for the next cutover**, not for a hosts-file incident.
