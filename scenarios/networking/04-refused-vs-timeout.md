# Connection refused in staging, timeout in production — same app, different meaning

## Briefing

The same health check fails in two environments with two different errors. Staging
returns `Connection refused` in under a second. Production hangs for thirty seconds
and then reports `Connection timed out`.

The on-call treated them as the same failure: "the service is down." They are not
the same failure. One is a host that is reachable and actively rejecting the port.
The other is a packet that never comes back. The next command you run depends on
which one you actually have.

## Your Task

- Reproduce both symptoms against a local listener and a firewalled/dropped path.
- Name which layer each error comes from (nothing listening vs packet dropped).
- Fix the refused case by starting the service on the right port, and the timeout
  case by opening the path (or proving the packet is dropped).

## Starter Files

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# two "environments", two errors that look like "it's down"
echo "== staging (nothing listening on 18080) =="
curl -sv --connect-timeout 3 http://127.0.0.1:18080/health || true
echo
echo "== production (packets dropped — simulate with a blackhole route) =="
# 192.0.2.1 is TEST-NET-1: unroutable, so you get a timeout, not a RST
curl -sv --connect-timeout 3 http://192.0.2.1:18080/health || true
```

## Expected Failure

```bash
bash check.sh
# staging:
# * Connected to 127.0.0.1 port 18080
# * Recv failure: Connection refused
# curl: (7) Failed to connect to 127.0.0.1 port 18080: Connection refused
#
# production:
# * Trying 192.0.2.1:18080...
# * Connection timed out after 3001 milliseconds
# curl: (28) Connection timed out after 3001 milliseconds
```

`Connection refused` is a TCP RST from a stack that has no listener. `Connection
timed out` is silence — DROP, blackhole, wrong route, or a host that is not there.

## Expected Outcome

Staging answers after a listener is bound:

```bash
python3 -m http.server 18080 --bind 127.0.0.1 &
curl -sS --connect-timeout 3 http://127.0.0.1:18080/ >/dev/null && echo staging-ok
# staging-ok
```

Production is diagnosed as a path problem, not an application crash:

```bash
# timeout + no RST in tcpdump = the packet never came back
ss -lnt | grep 18080    # is anything even listening on the far side?
ip route get 192.0.2.1  # where would this packet go?
```

You can state, without guessing, which error means "start the process" and which
means "open the firewall / fix the route".

## Hints

### Hint 1 — RST vs silence

`Connection refused` (curl 7) is fast: the kernel sent RST because nothing accepted
the SYN. `Connection timed out` (curl 28) is slow: SYN got no SYN-ACK. Do not restart
the application for a timeout until `ss -lnt` on the *server* shows a listener and
`tcpdump` on the path shows the SYN arriving.

### Hint 2 — Prove it with ss and a short timeout

On the target: `ss -lnt sport = :18080`. Empty plus refused = wrong port or crashed
process. Listener present plus client timeout = firewall, security group, or routing.
Always set `--connect-timeout` so a DROP does not look like a hang.

## Solution

Map the error to the layer, then act on that layer only.

```bash
# refused: nothing is listening (or listening elsewhere)
ss -lnt 'sport = :18080'
# start or bind the service on the port the client actually uses
python3 -m http.server 18080 --bind 0.0.0.0

# timeout: the packet did not come back
ip route get <dst>
# on Linux, a DROP rule or a missing security-group ingress looks identical to the client
# tcpdump -ni eth0 'tcp port 18080'   # SYN in, nothing out → local filter
# SYN never arrives → earlier hop
```

- **Refused is local and loud.** The host is up; the port is closed. Fix the process
  or the port in the URL.
- **Timeout is a missing reply.** Firewall DROP, blackhole route, wrong VPC, dead
  next hop. The application may be healthy on a network you cannot reach.
- **Ping is the wrong test for both.** ICMP and TCP 18080 are different permissions.
- **Name the curl exit code** in the ticket: 7 vs 28 tells the next person which
  toolbox to open.
