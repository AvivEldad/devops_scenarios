# tcpdump sees SYN, SYN-ACK, then the client keeps retransmitting SYN

## Briefing

A firewall in the path is stateful on the way there and a different router
handles the way back. The SYN hits the server. The SYN-ACK leaves via
another interface/ISP and never matches the firewall's conntrack (or hits
a strict RPF). The client never sees SYN-ACK and retransmits SYN. The
server has a half-open (or established) socket. Each side's capture is
self-consistent and they contradict each other.

Ping might work if ICMP is policy-routed differently from TCP 443.
`ss` on the server shows the connection. The client shows `SYN-SENT`.

## Your Task

- Capture both ends of the same handshake (same 4-tuple).
- Show SYN arriving and SYN-ACK leaving a different next hop than the SYN
  used, or not arriving at the client at all.
- Restore symmetric routing (conntrack, policy routing, SNAT so return
  hits the same firewall) and complete the handshake.

## Starter Files

### file: captures.txt

```
# client nic
12:00:00.010 IP 198.51.100.20.50000 > 203.0.113.8.443: Flags [S]
12:00:01.010 IP 198.51.100.20.50000 > 203.0.113.8.443: Flags [S]   # retransmit
12:00:03.010 IP 198.51.100.20.50000 > 203.0.113.8.443: Flags [S]

# server nic (different story)
12:00:00.020 IP 198.51.100.20.50000 > 10.4.12.80.443: Flags [S]
12:00:00.020 IP 10.4.12.80.443 > 198.51.100.20.50000: Flags [S.]   # SYN-ACK sent
12:00:00.020 IP 10.4.12.80.443 > 198.51.100.20.50000: Flags [S.]   # retransmit
# ip route get 198.51.100.20  on the server -> via ISP-B
# SYN arrived via ISP-A / firewall-A
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "On the server, compare:"
echo "  ip route get <client-ip>"
echo "  tcpdump -ni any 'tcp port 443 and host <client-ip>'"
echo "If SYN-ACK egress iface != SYN ingress iface, suspect asymmetry / RPF."
```

## Expected Failure

```bash
# client
ss -tnp | grep 443
# SYN-SENT  198.51.100.20:50000 -> 203.0.113.8:443

# server
ss -tnp | grep 50000
# SYN-RECV or ESTAB  10.4.12.80:443 -> 198.51.100.20:50000

# client never leaves SYN-SENT; handshake does not complete
```

Both captures are "correct". The path is not a single cable.

## Expected Outcome

```bash
# client
ss -tnp
# ESTAB ... :443

curl -sSI --connect-timeout 5 https://203.0.113.8/
# HTTP/1.1 200
```

Return traffic uses the same firewall/state domain as the SYN, or RPF is
`loose` where policy routing is required, or SNAT at the edge forces
symmetry.

## Hints

### Hint 1 — Two captures, one 4-tuple

If the server sent SYN-ACK and the client has no SYN-ACK, the problem is
the return path (or a middlebox dropping it), not the application listen
socket.

### Hint 2 — rp_filter and policy routing

`cat /proc/sys/net/ipv4/conf/*/rp_filter` — strict RPF drops a packet
whose return route is the other NIC. Multi-homed servers and "primary /
backup ISP" without stateful failover cause this weekly.

## Solution

Make the reverse path match the forward path.

```bash
ip route get 198.51.100.20
ip rule; ip route show table all
# conntrack on the firewall must see both directions
# SNAT at the ingress firewall so replies return to it
# or: policy route replies out the NIC the SYN arrived on (mark / connmark)
sudo sysctl net.ipv4.conf.all.rp_filter   # 1 strict, 2 loose
```

- **Asymmetry breaks stateful firewalls and strict RPF**, not just
  "weird traceroute".
- **SYN-SENT vs SYN-RECV** is the signature: both hosts are honest.
- **Ping is not a symmetry test** if ICMP is routed elsewhere.
- **Anycast and ECMP** produce the same class of bug for UDP and for
  TCP if there is no consistent hashing.
