# Short API calls work, the upload dies at 61 seconds every time

## Briefing

`GET /health` is fine. `PUT /objects` with a 200 MB body always fails at
roughly 60–65 seconds. The application log shows the handler still running.
The client sees `connection reset` or an empty reply. A packet capture at
the load balancer shows it sending RST after its idle timeout. The app
server's keepalive and the LB timeout disagree: the LB is 60s, the app
thinks the connection is still open, the client is mid-body.

Nobody changed the app. Someone tightened the ALB idle timeout last week
"for connection hygiene".

## Your Task

- Show that failures cluster at a round timeout (60s, 350s, 3600s).
- Identify whose timer fired (LB idle, NAT conntrack, cloud NLB, ingress
  `proxy_read_timeout`).
- Raise the idle timeout above the longest legitimate request, or send
  application-level keepalives, and confirm a long PUT succeeds.

## Starter Files

### file: timings.txt

```
# client logs (same object, three retries)
PUT /objects  duration=61.02s  error=connection reset by peer
PUT /objects  duration=60.98s  error=empty reply from server
PUT /objects  duration=61.11s  error=connection reset by peer
# GET /health  duration=0.04s  200
```

### file: nginx.broken.conf

```
# ingress / sidecar
proxy_read_timeout  60s;
proxy_send_timeout  60s;
# ALB idle timeout: 60 seconds (console)
# app itself: no problem at 180s in a direct curl to the pod IP
```

## Expected Failure

```bash
# curl directly to the pod/backend (bypassing LB): upload succeeds in ~90s
# curl through the LB: dies at ~60s
curl -sv --max-time 180 --upload-file big.bin https://api.example/objects
# * TLSv1.3 (IN), TLS alert, close notify (or RST)
# curl: (52) Empty reply from server     # typical at idle/proxy timeout
```

The application did not crash. A middlebox closed a connection it considered
idle because it does not count a slow upload as "activity" the way you think.

## Expected Outcome

Long requests finish through the same front door:

```bash
curl -sS --max-time 180 --upload-file big.bin https://api.example/objects
# 201
```

LB idle timeout, ingress read timeout, and any NAT conntrack UDP/TCP timeout
are all longer than the p99 request, or the app uses chunked/heartbeat so the
connection is not idle.

## Hints

### Hint 1 — Histogram the failure time

If many independent clients die at 60.0s or 350s, it is a timer, not a race
in your code. 350s is a famous AWS NAT-gateway / idle number; 60s is a common
ALB/nginx default.

### Hint 2 — Bypass the LB once

Curl the backend/pod IP (or `kubectl port-forward`) with the same body. If
that works past 60s, the app is innocent. Raise `idle_timeout`,
`proxy_read_timeout`, or enable HTTP keepalive pings / TCP keepalive with
a shorter interval than the middlebox.

## Solution

Align timers, then keep the connection obviously alive.

```bash
# ALB: idle timeout 60 -> 180 (or whatever p99 needs)
# nginx: proxy_read_timeout 180s; proxy_send_timeout 180s;
# GCP: backend timeout
# conntrack: sysctl net.netfilter.nf_conntrack_tcp_timeout_established
# app: periodic progress bytes or HTTP/2 pings on long RPCs
```

- **A wall-clock cluster at N seconds is a middlebox timer.**
- **Idle means "no TCP bytes the LB counts".** A stuck handler that does
  not write is idle even if the client is thinking.
- **Bypass one hop** to see whose clock it is.
- **TCP keepalive is not HTTP activity** on some LBs — test, do not assume.
