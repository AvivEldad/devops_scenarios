# Chrome is instant, curl is instant, the mobile app hangs until it falls back to HTTP/2

## Briefing

The site advertises HTTP/3 in `Alt-Svc` and the app (or a recent curl)
tries QUIC on UDP/443 first. Corporate egress and a "DNS-only" firewall
allow TCP 443 and drop UDP. The client waits for QUIC to time out before
HTTP/2. Laptops with curl defaulting to HTTP/1.1 never see it. The status
dashboard uses curl. The incident is "the app is slow on office wifi".

This is not TLS interception (that still speaks TCP). This is the
transport the middlebox does not know about.

## Your Task

- Show TCP/443 working and UDP/443 failing (`nc -u` is weak; use
  `curl --http3` or a capture).
- Prove the stall matches the QUIC timeout, then TCP succeeds.
- Either open UDP/443 end-to-end or disable Alt-Svc/HTTP3 at the edge
  until the path allows QUIC; measure curl --http3 vs --http2.

## Starter Files

### file: alt-svc.txt

```
HTTP/2 200
alt-svc: h3=":443"; ma=86400
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
HOST="${1:-www.example.com}"
echo "== TCP 443 =="
nc -vz -w 3 "$HOST" 443 || true
echo "== UDP 443 (may 'succeed' without a peer; capture is better) =="
echo "  tcpdump -ni eth0 'udp port 443'"
echo "== curl =="
curl -sv --connect-timeout 5 --http2 "https://$HOST/" -o /dev/null || true
echo "if curl is built with HTTP/3:"
echo "  curl -sv --http3-only --max-time 5 https://$HOST/"
```

## Expected Failure

```bash
curl --http3-only --max-time 5 -sv https://www.example.com/
# * QUIC: connection timeout
# curl: (28) Connection timed out

curl --http2 --max-time 5 -sv https://www.example.com/ -o /dev/null
# HTTP/2 200 in 80ms

# app logs: "h3 failed, falling back" after ~3–10s on office networks
```

TCP is fine. UDP 443 never returns.

## Expected Outcome

Either:

```bash
curl --http3 --max-time 5 -sv https://www.example.com/ -o /dev/null
# HTTP/3 200
```

or HTTP/3 is not advertised on networks that cannot carry it, so clients
do not stall:

```
# no Alt-Svc: h3  (or h3 only on a path you know allows UDP/443)
curl --http2  # remains the office fast path
```

## Hints

### Hint 1 — Dashboards lie if they use TCP-only probes

A TCP synthetic check will be green while QUIC-first clients wait. Probe
UDP/443 or `--http3-only` from the same network as the users.

### Hint 2 — Middleboxes and HTTP/3

Many "allow HTTPS" rules are `tcp/443`. QUIC is `udp/443`. TLS-inspecting
proxies often cannot inspect QUIC and drop it. Then Alt-Svc becomes an
outage amplifier.

## Solution

Measure both transports; do not assume HTTPS means TCP.

```bash
curl -sSI --http2 https://www.example.com/ | grep -i alt-svc
curl --http3-only --max-time 5 -o /dev/null https://www.example.com/
# firewall: allow udp/443 to the CDN/origin, or
# stop advertising h3 (CDN/nginx http3 off) until that exists
```

- **HTTP/3 is UDP.** Your HTTPS allowlist is probably TCP.
- **Alt-Svc can make working TCP sites feel broken.**
- **Synthetics must include `--http3-only`** if you advertise h3.
- **Inspection proxies and QUIC** usually mean "disable h3" or "bypass
  proxy for that destination", not "the app is slow".
