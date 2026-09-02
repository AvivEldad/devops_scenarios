# New connections fail with timeout, established SSH sessions keep working

## Briefing

A NAT gateway (or a Docker host, or `kube-proxy` in iptables mode) suddenly
cannot start new flows. Existing SSH sessions stay up. `dmesg` has
`nf_conntrack: table full, dropping packet`. `curl` from the box times
out even to local HTTP, or only through NAT.

This is not "the network is down". The table of *translations* is full, so
NEW packets are dropped while ESTABLISHED entries still forward. A burst
of short connections (health checks, scrapes, a connection leak) exhausted
`nf_conntrack_max`. Linux-30 may already have taught you the sysctl; here
the networking job is to see it as a NAT symptom, find who is creating
entries, and pick a fix that is not "reboot the NAT box during peak".

## Your Task

- Confirm the table is full (`count` vs `max`, dmesg).
- Identify the noisy 4-tuple pattern (one client, DNS UDP, TIME_WAIT).
- Raise the ceiling *and* remove the leak (or SNAT port exhaustion), then
  start a new connection without rebooting.

## Starter Files

### file: sysctl-excerpt.txt

```
net.netfilter.nf_conntrack_max = 65536
net.netfilter.nf_conntrack_count = 65536
# dmesg:
# nf_conntrack: table full, dropping packet
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "count=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null || echo n/a)"
echo "max=$(cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null || echo n/a)"
echo "conntrack -S 2>/dev/null || cat /proc/net/stat/nf_conntrack | head"
```

## Expected Failure

```bash
cat /proc/sys/net/netfilter/nf_conntrack_count
# 65536
curl -sv --connect-timeout 3 https://example.com/
# timeout  (NEW dropped)

# an old ssh session to the same NAT box still types fine
```

`ss` on the client shows SYN-SENT. The NAT box never created a mapping.

## Expected Outcome

```bash
cat /proc/sys/net/netfilter/nf_conntrack_count
# well below max

curl -sS --connect-timeout 5 -o /dev/null -w "%{http_code}\n" https://example.com
# 200
```

`nf_conntrack_max` is sized for peak, UDP timeouts are sane, and the
application that opened 40k short TCP connections is fixed.

## Hints

### Hint 1 — ESTABLISHED surviving NEW dying

That split is conntrack/NAT resource exhaustion, not a WAN cut. Check
count/max before drawing a new network diagram.

### Hint 2 — Who fills the table

`conntrack -L | awk '{print $1}' | sort | uniq -c`. DNS UDP with a long
timeout, or a proxy that does not reuse connections, or SNAT port
exhaustion (`insert_failed` in `conntrack -S`). Shorten
`nf_conntrack_udp_timeout` if DNS is the flood; fix the client if it is
a leak.

## Solution

Relieve the table, then stop filling it.

```bash
sudo dmesg | grep conntrack
cat /proc/sys/net/netfilter/nf_conntrack_{count,max}
sudo conntrack -S
# emergency: sysctl -w net.netfilter.nf_conntrack_max=262144
# hashsize: echo $((262144/8)) > /sys/module/nf_conntrack/parameters/hashsize
# real fix: connection reuse, fewer health-check targets, DNS caching
```

- **NEW vs ESTABLISHED split** is the operational signature.
- **Raising max is a safety valve**, not a substitute for a connection
  leak.
- **UDP DNS into a NAT** can dominate the table; cache locally.
- **Rebooting clears the table** and also kills the SSH sessions that
  were the only thing still working — prefer sysctl + conntrack -F of
  a specific noisy set if you must.
