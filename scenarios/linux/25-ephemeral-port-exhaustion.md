# Cannot assign requested address under load

## Briefing

A service that makes many short-lived outbound connections (a proxy, a load test, a batch
caller) starts failing under load with `Cannot assign requested address` (`EADDRINUSE` /
`EADDRNOTAVAIL`). Low traffic is fine; high traffic breaks. The machine has not run out of
memory or file descriptors — it has run out of *ports*.

Each outbound TCP connection uses an ephemeral local port. After closing, the port sits in
`TIME_WAIT` for a while before it can be reused. Under enough connection churn, the ephemeral
port range fills with `TIME_WAIT` sockets and new connections cannot get a local port.

## Your Task

- Reproduce ephemeral port exhaustion from high connection churn.
- Explain the ephemeral port range and the role of `TIME_WAIT`.
- Relieve it correctly — by reducing churn and tuning, not by blindly killing TIME_WAIT.

## Starter Files

### file: churn.py

```python
# Opens and closes many short-lived connections quickly (connection-per-request antipattern).
import socket, sys
target = ("127.0.0.1", 9)      # discard-like; adjust to a reachable listener
n = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
for i in range(n):
    s = socket.socket()
    try:
        s.connect(target)      # new ephemeral local port each time
    except OSError as e:
        print(f"failed after ~{i} conns: {e}")
        break
    finally:
        s.close()              # -> socket goes into TIME_WAIT
```

## Expected Failure

```bash
python3 churn.py 100000
# failed after ~28000 conns: [Errno 99] Cannot assign requested address
```

```bash
# the ephemeral range is full of TIME_WAIT:
ss -s
# TCP:  30000 (estab 5, ... timewait 28000)     <- huge TIME_WAIT count
cat /proc/sys/net/ipv4/ip_local_port_range
# 32768   60999                                 <- ~28000 usable ephemeral ports
```

Every connection consumed an ephemeral local port that then entered `TIME_WAIT` (held for
2×MSL, ~60s). Connections were created far faster than ports were released, so the ~28k-port
range filled and new `connect()` calls could not get a local port — `EADDRNOTAVAIL`.

## Expected Outcome

The workload sustains its connection rate without port exhaustion.

`TIME_WAIT` no longer saturates the range:

```bash
ss -s
# timewait count well within the ephemeral range; no allocation failures
```

Connections succeed at the required rate:

```bash
python3 churn.py 100000
# completes without 'Cannot assign requested address'
```

The real fix — reuse connections — is in place, and/or the tunables give more headroom:

```bash
sysctl net.ipv4.ip_local_port_range      # widened if appropriate
sysctl net.ipv4.tcp_tw_reuse             # 1: safely reuse TIME_WAIT for new outbound conns
```

## Hints

### Hint 1 — Ephemeral ports + TIME_WAIT is the mechanism

Outbound connections draw a local port from `ip_local_port_range` (~28k by default). On close,
the initiating side holds the socket in `TIME_WAIT` (2×MSL, ~60s) to catch stray packets. Rate
× 60s must stay under the range size, or you exhaust it. `ss -s` and `ss -tan state time-wait |
wc -l` quantify it.

### Hint 2 — Reuse connections first; tune second

The durable fix is to stop opening a connection per request: use HTTP keep-alive / a
connection pool so a handful of sockets serve thousands of requests. Then, if needed, widen
`ip_local_port_range` and enable `net.ipv4.tcp_tw_reuse=1` (safe for outbound; lets new
connections reuse TIME_WAIT sockets). Avoid the old `tcp_tw_recycle` — it was removed for
breaking NAT. Connecting to more distinct destinations also helps, since the 4-tuple includes
the remote address/port.

## Solution

Reduce connection churn (the root cause), then tune the port range/reuse for headroom.

```bash
# 1) confirm exhaustion
ss -s
ss -tan state time-wait | wc -l
cat /proc/sys/net/ipv4/ip_local_port_range

# 2) ROOT FIX: reuse connections (keep-alive / pooling) instead of one-per-request
#    - HTTP: enable keep-alive, use a session/pool (requests.Session, http.Client, etc.)
#    - this cuts sockets from tens of thousands to a small pool

# 3) headroom tuning (if churn is irreducible)
sudo sysctl -w net.ipv4.ip_local_port_range="1024 65535"   # widen usable range
sudo sysctl -w net.ipv4.tcp_tw_reuse=1                      # reuse TIME_WAIT for new outbound
#    persist in /etc/sysctl.d/*.conf
#    do NOT use tcp_tw_recycle (removed; breaks NAT)
```

- **Outbound connections consume ephemeral ports**, and each close parks a socket in
  `TIME_WAIT` for ~60s. Connection rate × TIME_WAIT duration must fit in the ~28k-port default
  range, or `connect()` fails with "Cannot assign requested address".
- **`TIME_WAIT` is correct, not a bug.** It ensures late/duplicate packets from a closed
  connection do not corrupt a new one on the same 4-tuple. The problem is *churn*, not
  TIME_WAIT's existence.
- **Fix the churn first: reuse connections.** Keep-alive and connection pools turn a
  connection-per-request storm into a few long-lived sockets — this eliminates the problem
  rather than papering over it.
- **Then tune with headroom in mind**: widen `ip_local_port_range`, enable `tcp_tw_reuse=1`
  for outbound reuse. Never enable the removed `tcp_tw_recycle` — it silently breaks clients
  behind NAT.
- **The 4-tuple is (src IP, src port, dst IP, dst port)** — many destinations spread the load
  across more tuples, so exhaustion is worst when hammering a single remote endpoint. `ss -s` is
  your quick health check.
