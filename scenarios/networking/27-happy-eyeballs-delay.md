# Dual-stack clients wait two seconds before every request; IPv4-only clients do not

## Briefing

`curl -4` is 50ms. `curl` (default) is ~250–2000ms to first byte, then
fine. `getent ahosts` returns AAAA and A. The AAAA targets a prefix that
blackholes (or a firewall that drops silently for 2s). Happy Eyeballs
(RFC 8305) races v6 first, waits, then tries v4. The site is "up". The
SLA for API latency is not.

This is related to a dead AAAA (beginner) but the A record *exists* and
the product still fails its latency budget. The fix may be withdrawing
AAAA, fixing v6, or tuning the race — not adding app retries.

## Your Task

- Time `curl -4`, `curl -6`, and `curl` on the same URL.
- Show AAAA is slow/blackholed while A is fast.
- Restore v6 or stop advertising AAAA until it is; confirm default curl
  matches the v4 time.

## Starter Files

### file: times.txt

```
curl -4 -sS -o /dev/null -w "v4 connect=%{time_connect} ttfb=%{time_starttransfer}\n" https://api.example/
# v4 connect=0.04 ttfb=0.07

curl -6 -sS -o /dev/null -w "v6 connect=%{time_connect}\n" --connect-timeout 5 https://api.example/
# v6 connect=2.00   (or timeout)

curl    -sS -o /dev/null -w "auto connect=%{time_connect} ttfb=%{time_starttransfer}\n" https://api.example/
# auto connect=1.85 ttfb=1.92
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
URL="${1:-https://api.example/}"
for f in -4 -6 ""; do
  echo "curl $f"
  curl ${f:+$f} -sS -o /dev/null --connect-timeout 5 \
    -w "connect=%{time_connect} ttfb=%{time_starttransfer} err=%{errormsg}\n" \
    "$URL" || true
done
```

## Expected Failure

```bash
bash check.sh
# -4  connect=0.04
# -6  connect=2.00  or timeout
#     connect=1.85   # happy eyeballs delay
```

No HTTP 5xx. The app traces look "slow DNS" or "slow TLS" because the
wait is inside `connect()`.

## Expected Outcome

```bash
curl -sS -o /dev/null -w "connect=%{time_connect}\n" https://api.example/
# connect=0.04     # same order as -4

# and/or curl -6 also ~0.04 after v6 is actually routed
```

AAAA is honest. Clients no longer burn the Happy Eyeballs delay on every
new connection.

## Hints

### Hint 1 — Split the families

If `-6` is two seconds and `-4` is instant, default dual-stack will sit
in the race. Application APM that does not label address family will
blame the service.

### Hint 2 — Fix DNS or the path, not the Go dialer first

Withdrawing a lying AAAA is a valid incident fix. Tuning
`HappyEyeballsTimeout` hides the outage in one binary. Prefer making v6
work or not publishing it.

## Solution

Make the AAAA true, or stop publishing it.

```bash
dig A api.example; dig AAAA api.example
curl -6 --connect-timeout 2 -o /dev/null https://api.example/
ip -6 route get "$(dig +short AAAA api.example | head -1)"
# Route53/Cloud DNS: remove AAAA until the prefix is reachable from clients
```

- **Happy Eyeballs turns a v6 blackhole into latency**, not always into
  a hard error.
- **Synthetics that force `-4` will never see it.**
- **Publishing AAAA is a product decision** about the v6 path, not a
  checkbox on the DNS record.
- **Connection reuse** hides this on keep-alive; it comes back on every
  new process and every reconnect.
