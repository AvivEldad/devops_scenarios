# Traceroute dies at hop 3, so they opened a change to replace the router — TCP still works

## Briefing

A user ran `traceroute reports.internal` and it stopped after hop 3 with stars.
The network ticket says the core is down. Meanwhile `curl https://reports.internal`
from the same laptop returns 200 in 40ms. Someone is drafting a router reboot.

Classic traceroute sends UDP or ICMP toward high ports and expects ICMP
Time Exceeded. Plenty of networks rate-limit or drop those probes and still
forward TCP 443. Stars are not a down router. They are "this hop did not
answer *this* probe."

This is the inverse of "ping works, the site is down": here the site works and
the diagnostic lies.

## Your Task

- Reproduce stars in traceroute (or explain why your ISP shows them) while
  TCP to 443 succeeds.
- Use a TCP traceroute (or `mtr --tcp`, `nc -vz`) to the real port.
- Write the one-sentence rule for when traceroute is evidence and when it is
  not.

## Starter Files

### file: compare.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
HOST="${1:-example.com}"
echo "== ICMP/UDP traceroute (often stars) =="
traceroute -n -w 2 -m 8 "$HOST" 2>/dev/null || traceroute -n -w 2 -m 8 "$HOST" || true
echo
echo "== the service the user actually needs =="
curl -sS --connect-timeout 5 -o /dev/null -w "tcp 443 -> %{http_code} time=%{time_connect}\n" "https://$HOST/" || true
echo
echo "== TCP connect to the real port =="
nc -vz -w 3 "$HOST" 443 2>&1 || true
```

## Expected Failure

```bash
bash compare.sh reports.internal
# traceroute:
#  1  10.4.0.1
#  2  *
#  3  *
#  4  *
# curl:
# tcp 443 -> 200 time=0.041
```

Stars after hop 1 with a working HTTPS session are not a core outage.

## Expected Outcome

The ticket is closed against the application of traceroute, not against the
router, unless TCP to the service port also fails:

```bash
# Debian/Ubuntu: sudo apt install traceroute
sudo traceroute -T -p 443 -n reports.internal
# or: mtr -n --tcp -P 443 reports.internal
# hops may still hide, but the last hop answering 443 is the evidence that matters
```

You can explain that ICMP Time Exceeded and TCP 443 are different permissions.

## Hints

### Hint 1 — Stars mean "no probe reply"

A hop may forward your traffic and still drop traceroute probes. `*` is missing
ICMP Time Exceeded or UDP/ICMP echo, not proof of a blackhole for TCP.

### Hint 2 — Traceroute to the port you care about

`traceroute -T -p 443` (TCP SYN) or `mtr --tcp -P 443` matches the user path
better. Even then, middleboxes may SYN-ACK from a different place. The
authoritative test remains: connect to the service, then capture if it fails.

## Solution

Believe the service, then use traceroute as a path hint — not the other way
around.

```bash
curl -sv --connect-timeout 5 https://reports.internal/health
nc -vz reports.internal 443
# only if that fails:
sudo traceroute -T -p 443 -n reports.internal
mtr -n --tcp -P 443 reports.internal
```

- **Working TCP + starred traceroute is not a down router.**
- **Ping/traceroute/curl are three different protocols.** Any one can lie
  about the others.
- **Use TCP traceroute to the service port** when you need a path picture.
- **Do not reboot hop 3** because `*` appeared in an ICMP traceroute.
