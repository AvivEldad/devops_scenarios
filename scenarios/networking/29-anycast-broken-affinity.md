# DNS is anycast, some offices get a POP that still has yesterday's zone

## Briefing

`ns1.example.net` is announced from three sites (anycast 192.0.2.53). A
zone update is visible if you `dig @` a unicast hidden master. From office
A, `dig @192.0.2.53` returns the new serial. From office B, the serial is
old for twenty minutes, then flips. TCP sessions to an anycast *application*
VIP reset when BGP withdraws one POP and the next packet lands on another
host with no state.

Two different anycast failures get mixed together: (1) DNS POPs out of
sync, (2) stateful TCP on an anycast VIP. Both look like "DNS is flaky"
or "the LB is broken".

## Your Task

- Query the anycast address from two paths (or `+nsid` / CHAOS `id.server`)
  and show different backends.
- For DNS: wait for AXFR/NOTIFY, or remove the stale POP from the
  announcement until it has the new serial.
- For TCP: do not put stateful sessions on pure anycast without consistent
  hashing / a connection-aware fabric; use a DNS name that can fail over
  or terminate TCP at one site.

## Starter Files

### file: nsid.txt

```
$ dig +nsid @192.0.2.53 example.com SOA +norecurse
; NSID: 70 6f 70 2d 61  ("pop-a")
example.com.  300  IN SOA ns1.example.net. ... 2026090201

$ dig +nsid @192.0.2.53 example.com SOA +norecurse     # from office B
; NSID: 70 6f 70 2d 62  ("pop-b")
example.com.  300  IN SOA ns1.example.net. ... 2026090109   # stale
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "Identify which POP answered:"
echo "  dig +nsid @192.0.2.53 hostname.bind CHAOS TXT"
echo "  dig +nsid @192.0.2.53 example.com SOA"
echo "Compare serials. Do not assume one dig represents the anycast cloud."
```

## Expected Failure

```bash
dig +short @192.0.2.53 example.com SOA
# 2026090109          # stale POP

dig +short @203.0.113.53 example.com SOA   # unicast master
# 2026090201

# TCP anycast app:
# * Connected
# * Recv failure: Connection reset by peer   # after a POP drain
```

## Expected Outcome

Every POP that still announces the anycast service has the new SOA serial
(or the stale POP is withdrawn):

```bash
dig +nsid @192.0.2.53 example.com SOA
# serial 2026090201
# NSID tells you which POP; repeat from another egress if you can
```

Stateful TCP is not expected to survive a POP fail-over unless the
platform is built for it.

## Hints

### Hint 1 — NSID / CHAOS identity

`+nsid` or `id.server`/`hostname.bind` CHAOS TXT tells you *which
instance* answered 192.0.2.53. Without that, two digs are not comparable.

### Hint 2 — Anycast + TCP state

UDP DNS is the success story for anycast (short, stateless). Long TCP
(HTTPS) to an anycast VIP resets when BGP moves you. That is architecture,
not a kernel bug.

## Solution

See the POP, then make the announcement match health.

```bash
dig +nsid @192.0.2.53 example.com SOA
dig @<unicast-axfr-master> example.com SOA
# withdraw BGP for pop-b until serial matches (anycast health check on SOA)
# TCP apps: GeoDNS / Anycast only to stateless frontends / Maglev-style hashing
```

- **Anycast is many machines, one address.** One `dig` is one POP.
- **Stale DNS POP** is a replication/health-check problem.
- **RST after failover** on TCP anycast is expected without shared state.
- **Health checks must run on the announced service** (SOA serial, not
  "the host pings").
