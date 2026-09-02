# The host can ping its neighbour and cannot reach the internet

## Briefing

A new VM came up from the image. It can ping `10.4.12.1` on the local subnet.
`curl https://registry.example` times out. `ip addr` looks fine. DNS is
configured. Someone added a static `10.4.12.0/24` route "because that's our
network" and never added a default.

Same symptom if DHCP failed to install `default via 10.4.12.1`. Same symptom
in a container with `--network none` plus a veth and no default. The interface
is up; there is nowhere to send packets whose destination is not on-link.

## Your Task

- Show on-link neighbours work and off-subnet destinations have no route.
- Install the correct default (or restore DHCP), and confirm `ip route get`
  for an internet address uses that gateway.
- Curl a host off the subnet.

## Starter Files

### file: routes.broken

```
# ip route (simplified)
10.4.12.0/24 dev eth0 proto kernel scope link src 10.4.12.44
# no "default via 10.4.12.1 dev eth0"
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "on-link (works without a default): ping the gateway IP if you are on-link"
echo "off-link: ip route get 1.1.1.1"
ip route get 1.1.1.1 2>&1 || true
echo
echo "ip route:"
ip route || true
```

## Expected Failure

```bash
ip route get 1.1.1.1
# RTNETLINK answers: Network is unreachable

ping -c1 -W2 1.1.1.1
# Network is unreachable

curl -sv --connect-timeout 3 https://1.1.1.1/
# curl: (7) Failed to connect: Network is unreachable
```

Not a DNS incident (`Network is unreachable` happens before a SYN). Not a
firewall timeout. There is no path.

## Expected Outcome

```bash
ip route
# default via 10.4.12.1 dev eth0

ip route get 1.1.1.1
# 1.1.1.1 via 10.4.12.1 dev eth0 src 10.4.12.44

curl -sS --connect-timeout 5 -o /dev/null -w "%{http_code}\n" https://example.com
# 200
```

## Hints

### Hint 1 — ip route get is the question

`ip route get <dst>` tells you what the kernel would do with one packet.
`Network is unreachable` means no matching route, including no default.
Do not debug TLS or DNS until this command shows a gateway.

### Hint 2 — On-link success is a trap

Pinging the gateway or another host in `/24` only proves ARP and the NIC.
The internet is not on-link. DHCP `routers` option, cloud metadata default
route, or a static `default via` must exist.

## Solution

Put a default route back, from the same source of truth as the rest of the
network (DHCP, cloud-init, netplan), not a one-off `ip route add` you will
lose on reboot.

```bash
ip route get 1.1.1.1
sudo ip route add default via 10.4.12.1 dev eth0   # emergency
# persist: netplan, NM, systemd-networkd, cloud-init
# dhcp: check /var/lib/dhcp or journalctl -u systemd-networkd
```

- **`Network is unreachable` is routing**, not HTTP.
- **A connected subnet route is not a default.**
- **`ip route get` is faster than traceroute** when the table is empty.
- **Persist the route.** A manual `ip route add` dies on reboot and becomes
  a recurring incident.
