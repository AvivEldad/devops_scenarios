# Packets leave with a private source and the next hop throws them away

## Briefing

`ip_forward` is 1. FORWARD is open. tcpdump on the egress NIC now shows
packets leaving — with source `10.8.0.50`. The ISP, the cloud internet
gateway, or the upstream RFC1918 filter drops them. Replies never exist.
From the lab client it looks like a timeout. From the router it looks like
"we sent it."

You need SNAT or MASQUERADE so return traffic has a path back to this box.

## Your Task

- Capture an egress packet and read the source address.
- Add MASQUERADE (or SNAT to the public/EIP) on the egress interface.
- Confirm the client flow works and conntrack shows the translation.

## Starter Files

### file: nat.broken

```
# iptables -t nat -L POSTROUTING -n
# Chain POSTROUTING (policy ACCEPT)
# (empty)
# packets from 10.8.0.0/24 exit eth0 still sourced from 10.8.0.0/24
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "Without SNAT, tcpdump -ni eth0 'ip' shows src=10.8.0.x on the WAN NIC."
echo "Those packets are not globally routable."
echo
echo "conntrack -L 2>/dev/null | head"
```

## Expected Failure

```bash
# tcpdump -ni eth0 host 1.1.1.1
# IP 10.8.0.50.12345 > 1.1.1.1.443: Flags [S]     <- private source on WAN

# from the client:
curl -sv --connect-timeout 5 https://example.com/
# curl: (28) Connection timed out
```

Forwarding worked. Translation did not.

## Expected Outcome

```bash
sudo iptables -t nat -L POSTROUTING -n -v
# MASQUERADE  all  --  10.8.0.0/24  0.0.0.0/0

# tcpdump on eth0: src is the WAN address (or EIP), not 10.8.0.50
# conntrack: src=10.8.0.50 dst=1.1.1.1 ... src=1.1.1.1 dst=<wan ip>

curl -sS --connect-timeout 5 -o /dev/null -w "%{http_code}\n" https://example.com
# 200
```

## Hints

### Hint 1 — Look at the source on the WAN tcpdump

If src is still RFC1918 on the public NIC, you are missing POSTROUTING SNAT.
This is independent of `ip_forward`.

### Hint 2 — MASQUERADE vs SNAT

MASQUERADE picks the current address of the out-interface (DHCP, flaky WAN).
SNAT `--to-source 203.0.113.8` is right for a stable EIP. Both live in
`iptables -t nat -A POSTROUTING`. nft: `oifname "eth0" masquerade`.

## Solution

Translate on the way out.

```bash
sudo iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o eth0 -j MASQUERADE
# or: -j SNAT --to-source 203.0.113.8
sudo conntrack -L | head
```

- **Forwarding without SNAT leaks private sources** onto a network that will
  not route them back.
- **tcpdump the WAN source IP**, not only "are packets leaving".
- **Return path is conntrack.** If SNAT is missing, there is nothing to
  un-translate.
- **Cloud equivalent:** instance in a private subnet needs a NAT gateway,
  not just a route to `0.0.0.0/0` pointing at a non-NAT box.
