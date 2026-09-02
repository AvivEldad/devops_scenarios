# The router has two interfaces and packets die in the kernel

## Briefing

A small Linux box is supposed to NAT a lab subnet `10.8.0.0/24` out through
`eth0`. Hosts on the lab veth can ping each other. They cannot ping 1.1.1.1.
tcpdump on the inside interface shows the SYN arriving. tcpdump on `eth0`
shows nothing leaving. `iptables -t nat -L` already has MASQUERADE.

The box is not a router until `ip_forward` is 1. NAT rules in `nat` never run
for forwarded packets if the kernel drops them in FORWARD first — and by
default many images have forwarding off.

## Your Task

- Show that forwarding is disabled (`/proc/sys/net/ipv4/ip_forward` is 0).
- Enable it (and persist it), and confirm packets appear on the egress NIC.
- Do not confuse this with a missing MASQUERADE (that is the next drill).

## Starter Files

### file: sysctl.broken

```
# /etc/sysctl.d/99-lab-router.conf  — missing or commented
# net.ipv4.ip_forward = 0          # default on many hosts
net.ipv4.ip_forward = 0
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "ip_forward=$(cat /proc/sys/net/ipv4/ip_forward)"
echo "FORWARD policy (often DROP on hardened images):"
iptables -L FORWARD -n 2>/dev/null | head || nft list chain ip filter FORWARD 2>/dev/null || true
```

## Expected Failure

```bash
cat /proc/sys/net/ipv4/ip_forward
# 0

# from a lab client behind the box:
ping -c1 -W2 1.1.1.1
# 100% packet loss

# on the "router":
# tcpdump -ni eth-int icmp   # echo request in
# tcpdump -ni eth0 icmp      # nothing out
```

The NAT table can look correct while forwarding is off.

## Expected Outcome

```bash
cat /proc/sys/net/ipv4/ip_forward
# 1

iptables -L FORWARD -n
# policy ACCEPT, or explicit allows for the lab subnet

# from the client:
ping -c1 -W2 1.1.1.1
# 1 received
```

`sysctl` is persisted so the next reboot does not restore the outage.

## Hints

### Hint 1 — Forwarding is a sysctl, not an iptables destination

Packets that arrive on one NIC and should leave another are `FORWARD`, not
`INPUT`. If `ip_forward=0`, the kernel does not route them. MASQUERADE never
gets a chance.

### Hint 2 — FORWARD policy DROP

Even with `ip_forward=1`, a DROP policy on FORWARD (Docker host, hardened CIS
image) blackholes the lab. Allow the pair of interfaces or the subnet, then
NAT.

## Solution

Turn the box into a router on purpose.

```bash
sudo sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-ip-forward.conf
sudo iptables -P FORWARD ACCEPT   # or a tight allow for 10.8.0.0/24
# docker: iptables -I DOCKER-USER ... if Docker owns FORWARD
```

- **Two NICs plus NAT rules ≠ a router.** `ip_forward` must be 1.
- **tcpdump both sides.** In without out is forwarding or FORWARD policy.
- **Persist sysctl.** `sysctl -w` dies on reboot.
- **IPv6 is a separate knob:** `net.ipv6.conf.all.forwarding`.
