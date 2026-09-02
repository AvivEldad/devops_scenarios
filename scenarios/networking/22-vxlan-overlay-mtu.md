# Pod-to-pod is fine, crossing the overlay dies at 1420-byte payloads — ICMP still works

## Briefing

This is not the ICMP-black-hole incident. Path MTU discovery works on the
underlay. Small pings and small HTTP bodies work everywhere. Payloads that
fit in a 1500-byte inner packet fail as soon as they traverse VXLAN/GENEVE
because the encapsulating outer header is ~50 extra bytes and the underlay
is still 1500.

Hosts on the same hypervisor (no overlay hop) never see it. Hosts across
racks do. Someone raised `rp_filter` and disabled PMTUD on the inner
interface "to stop ICMP noise", so the inner stack still emits 1500-byte
packets that the outer path cannot carry. Unlike a classic black hole,
`ping -M do -s 1472` on the underlay succeeds; `ping -M do -s 1472` on the
overlay IP fails.

## Your Task

- Measure underlay MTU vs overlay MTU (`ip link`, `ip -d link show vxlan0`).
- Find the size threshold that only fails across the overlay.
- Set the overlay interface / pod network MTU so inner packets plus
  encapsulation fit (commonly 1450 or 1400), and retest a large GET.

## Starter Files

### file: mtu.txt

```
# ip link
eth0      mtu 1500     # underlay
vxlan0    mtu 1500     # WRONG: should be 1500 minus VXLAN+IP+UDP (~50)
cni0      mtu 1500     # pods inherit this
# VXLAN overhead typical: 20 IP + 8 UDP + 8 VXLAN = 36, plus inner Ethernet
# 1500 inner + outer > 1500 underlay
```

### file: sizes.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
DST="${1:-10.244.2.10}"
echo "underlay don't-fragment (should work at 1472 on a 1500 path):"
echo "  ping -c1 -M do -s 1472 <underlay-ip>"
echo "overlay don't-fragment (fails if vxlan mtu is 1500):"
ping -c1 -W2 -M do -s 1472 "$DST" || true
```

## Expected Failure

```bash
ping -c1 -M do -s 1472 10.244.2.10
# From 10.244.1.1 icmp_seq=1 Frag needed and DF set (mtu = 1450)
# or: 100% packet loss if inner PMTUD is filtered

curl http://10.244.2.10/large.bin -o /dev/null
# stalls or resets once the inner packet would exceed overlay MTU
```

Underlay `ping -M do -s 1472` to the other node's `eth0` still works.

## Expected Outcome

```bash
ip link show vxlan0
# mtu 1450

ping -c1 -M do -s 1422 10.244.2.10
# 1 received

curl -sS -o /dev/null -w "%{http_code} %{size_download}\n" http://10.244.2.10/large.bin
# 200 10485760
```

CNI / Calico / Flannel / cloud overlay MTU is set from the underlay minus
overhead, not copied from 1500.

## Hints

### Hint 1 — Two MTUs

`ip link` on `eth0` and on `flannel.1` / `vxlan.calico` / `cilium_vxlan`.
If they are equal, encapsulation will not fit. This is configuration, not
a silent ICMP drop — though filtering inner ICMP makes it look like net-03.

### Hint 2 — Same-node vs cross-node

Traffic that stays on `cni0`/`veth` never hits VXLAN. Always reproduce from
a pod scheduled on a *different* node. `kubectl get pod -o wide`.

## Solution

Shrink the inner MTU (or jumbo the underlay).

```bash
ip -d link show vxlan0
# AWS VXLAN/GENEVE: often 8901 jumbo underlay or 1450 overlay
# Calico: veth_mtu / Encapsulation
# Flannel: flanneld --iface and Network MTU
sudo ip link set vxlan0 mtu 1450
```

- **Overlay MTU must be underlay minus encap.** Copying 1500 is a latent
  outage for large bodies only.
- **This is not net-03** if underlay PMTUD works and the overlay iface MTU
  is simply wrong.
- **Reproduce cross-node.** Same-node hides VXLAN.
- **Jumbo underlay (9000) is the other fix** in a DC you control; in public
  cloud you usually lower the overlay.
