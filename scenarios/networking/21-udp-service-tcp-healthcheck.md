# The UDP service is up and the load balancer keeps taking it out of rotation

## Briefing

`dns-cache` listens on `udp/53`. The NLB / kube-proxy health check is the
default: TCP connect to 53. Nothing accepts TCP 53 (or TCP 53 speaks a
different protocol). The target is marked unhealthy. DNS queries that
reach a surviving node work. Half the fleet is empty because the health
check never asked a DNS question.

TCP and UDP port numbers are not the same service. A listener on UDP 53
does not imply a TCP socket, and a TCP SYN succeeding on 53 does not imply
DNS (it might be a discarded connect or a different daemon).

## Your Task

- Show `ss` with UDP vs TCP sockets on the same number.
- Demonstrate a TCP health check failing (or succeeding at the wrong
  layer) while `dig @that-ip` works.
- Point the health check at a UDP probe or an HTTP sidecar that actually
  queries DNS.

## Starter Files

### file: ss-excerpt.txt

```
udp   UNCONN  0  0  0.0.0.0:53   0.0.0.0:*   users:(("coredns",pid=1))
tcp   LISTEN  0  0  127.0.0.1:8080 0.0.0.0:* users:(("coredns",pid=1))
# no tcp *:53
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
IP="${1:-127.0.0.1}"
echo "== TCP health check the LB is using =="
nc -vz -w 2 "$IP" 53 || true
echo "== the actual protocol =="
dig +short +time=2 +tries=1 @"$IP" example.com A || true
```

## Expected Failure

```bash
nc -vz -w 2 10.4.12.53 53
# nc: connect to 10.4.12.53 port 53 (tcp) failed: Connection refused

dig +short +time=2 @"10.4.12.53" example.com
# 93.184.216.34

# LB console: target unhealthy; DNS still works on nodes that were
# manually registered without that check
```

The health check measured a socket that does not exist.

## Expected Outcome

The load balancer considers the instance healthy iff DNS (or your real
readiness) works:

```bash
# AWS NLB: UDP health check, or HTTP on :8080 /health that runs a local dig
# kube: udp socket + matching readiness, or exec probe: dig @127.0.0.1 ...
dig +short +time=2 @<vip> example.com
# answer
```

TCP/53 is only required if you actually serve DNS over TCP (AXFR, large
answers). Then check TCP too — separately.

## Hints

### Hint 1 — ss -ulnp vs ss -tlnp

Same port number, different protocol column. Health checks must match
`ss`. `nc` without `-u` is TCP.

### Hint 2 — UDP "connect" is a lie

`nc -u` can "succeed" without a peer. Use an application probe (`dig`,
`openssl s_client` for QUIC is still not HTTP). For NLB, use the UDP
health check or an HTTP sidecar.

## Solution

Probe the protocol you serve.

```bash
ss -ulnp | grep ':53'
ss -tlnp | grep ':53'
dig +short @127.0.0.1 health.example.com
# LB health: HTTP GET http://127.0.0.1:8080/health
# not: TCP :53
```

- **Port numbers are scoped by protocol.** UDP/53 ≠ TCP/53.
- **Default TCP health checks on UDP services** empty the pool.
- **DNS-over-TCP is a different readiness** (truncation, AXFR, firewalls
  that allow only UDP).
- **A successful TCP handshake is not a DNS answer.** Ask a question.
