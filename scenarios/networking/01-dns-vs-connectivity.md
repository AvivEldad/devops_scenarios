# "The site is down" — but ping works

## Briefing

A ticket arrives: *"reports.internal is down, but I can ping it fine, so it must be
the application."*

The application team says their service is healthy and has the dashboards to prove it.
The network team says the host responds to ping. Both are correct, and the site is
still unreachable for this user.

This scenario is about the most common category confusion in operations: treating
"the machine answers" and "the service answers" as the same question, and treating
"DNS resolves" as "DNS resolves to the right place".

> Works on any Linux or macOS machine. You need `sudo` to edit `/etc/hosts`, plus
> `curl` and `dig` (from `dnsutils` or `bind-utils`).

## Your Task

Run the setup, which reproduces the user's situation on your own machine, then work
out what is actually wrong.

1. Reproduce the symptom: ping succeeds, the site does not load.
2. Establish, with evidence, which layer is failing — name resolution, transport, or
   the application.
3. Fix it and confirm the service responds.
4. Explain why ping succeeding was misleading, and what you should have run first.

You may not skip straight to editing `/etc/hosts` because you guessed. Work out what
is wrong first, then fix it.

```bash
mkdir -p ~/breakfix/net-01 && cd ~/breakfix/net-01
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Reproduces the user's broken state on this machine.
set -euo pipefail

rm -rf lab && mkdir lab && cd lab

# the real service, listening on 8080
cat > service.py <<'EOF'
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"reports service ok\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, fmt, *a):
        print("request %s" % (fmt % a), flush=True)

print("reports listening on 127.0.0.1:8080", flush=True)
HTTPServer(("127.0.0.1", 8080), H).serve_forever()
EOF

nohup python3 service.py > service.log 2>&1 &
disown || true
sleep 1

echo
echo "Now add the stale DNS entry the user has (requires sudo):"
echo
echo "    echo '203.0.113.42  reports.internal' | sudo tee -a /etc/hosts"
echo
echo "203.0.113.42 is a documentation address that goes nowhere."
echo "Undo it later with:  sudo sed -i '/reports.internal/d' /etc/hosts"
echo
echo "service running on 127.0.0.1:8080 (log: $(pwd)/service.log)"
```

## Expected Failure

Run the setup and add the hosts entry it prints. Now reproduce the ticket:

```bash
ping -c 2 reports.internal
```

```
PING reports.internal (203.0.113.42) 56(84) bytes of data.
--- reports.internal ping statistics ---
2 packets transmitted, 0 received, 100% packet loss
```

Depending on your network you may get replies or you may get loss — and this is the
first trap. The user reported "ping works", and on their network it may well have,
because something along the path answered. Ping tells you almost nothing about a web
service either way.

```bash
curl -sS --max-time 5 http://reports.internal:8080
# curl: (28) Connection timed out after 5001 milliseconds
```

Meanwhile the service is definitely running:

```bash
curl -sS http://127.0.0.1:8080
# reports service ok
```

So: the service works, the name resolves, and requests to the name fail. There are
two separate faults, and one of them will still be there after you fix the name.

## Expected Outcome

The service must be reachable by name from your machine.

Name resolution points somewhere real:

```bash
getent hosts reports.internal
# 127.0.0.1       reports.internal
```

The HTTP request succeeds by name:

```bash
curl -sS --max-time 5 http://reports.internal:8080
# reports service ok
```

The request reached the application, proving it was not answered by something else:

```bash
tail -2 ~/breakfix/net-01/lab/service.log
# request "GET / HTTP/1.1" 200 -
```

You can state which layer each tool exercised. Confirm the distinction concretely —
this must **fail**, and you should be able to say why without it being alarming:

```bash
curl -sS --max-time 5 http://reports.internal:9999
# Connection refused - nothing listens on 9999, which is a DIFFERENT failure
#                      from the timeout you saw earlier
```

Resolution and connection are separately verifiable:

```bash
# name -> address, with no connection attempt
dig +short reports.internal
getent hosts reports.internal

# address -> port, with no name involved
curl -sS --max-time 5 http://127.0.0.1:8080
```

Clean up when finished:

```bash
sudo sed -i '/reports.internal/d' /etc/hosts
pkill -f service.py
```

## Hints

### Hint 1 — Ping and curl test different things

`ping` sends ICMP echo requests. It tells you whether *an IP stack* somewhere responds
to ICMP. It says nothing about:

- whether DNS gave you the **right** address (only that it gave you one)
- whether any TCP port is open
- whether an application is listening
- whether that application is healthy

Many hosts and firewalls drop ICMP entirely, so "ping fails" does not mean down, and
plenty of hosts answer ICMP while every service on them is dead, so "ping works" does
not mean up. It is the wrong tool for a web service in both directions.

Test the actual protocol: `curl` for HTTP, `nc -zv host port` for a raw TCP check.

### Hint 2 — Separate name resolution from everything else

Answer "what address does this name give me?" as its own question:

```bash
getent hosts reports.internal    # what the system resolver returns
dig +short reports.internal      # what DNS returns
```

These can differ, and the difference is the answer. `getent` follows
`/etc/nsswitch.conf`, so it consults `/etc/hosts` first on most systems; `dig` talks
to a DNS server directly and ignores `/etc/hosts` completely.

**When `dig` and `getent` disagree, look at `/etc/hosts`.** That gap is the single
most useful diagnostic in this scenario, and it catches an enormous number of real
"it works on my machine" problems.

### Hint 3 — Read the failure mode carefully

The distinctions carry real information:

| Symptom | Means |
|---|---|
| `Could not resolve host` | DNS failed; no address at all |
| Connection **timed out** | Packets are being dropped — wrong address, firewall, or routing |
| Connection **refused** | Packets arrived; nothing is listening on that port |
| TLS error | You connected fine; the problem is certificates or protocol |
| HTTP 502/503 | You reached a proxy; the thing behind it is unhealthy |

A timeout to `203.0.113.42` is exactly what you would expect from an address that goes
nowhere. `203.0.113.0/24` is reserved by RFC 5737 for documentation, which is a strong
hint that the entry was copied from an example.

### Hint 4 — The second fault is the listening address

Once the name resolves to `127.0.0.1`, look again at the service:

```bash
ss -ltnp 'sport = :8080'
head -1 ~/breakfix/net-01/lab/service.log
```

It binds `127.0.0.1`, so it is reachable from this machine and from nowhere else. For
this exercise that is sufficient, but recognise it as the same fault as the Docker
port scenario: a loopback-only listener is invisible to every other host, and it is
why a service can be "up" and unreachable for everyone but the person who checked.

### Hint 5 — Know the resolution order

Name lookups on Linux follow `/etc/nsswitch.conf`, typically:

1. `/etc/hosts` — a static file, always wins if it matches
2. DNS — the servers in `/etc/resolv.conf`, or systemd-resolved

```bash
cat /etc/nsswitch.conf | grep hosts
cat /etc/resolv.conf
resolvectl status        # on systemd systems
```

A stale `/etc/hosts` entry overrides correct DNS silently and permanently. It is a
frequent cause of one person seeing a different service than everyone else, and it
survives every DNS fix anyone makes upstream.

## Solution

Two faults: a stale static host entry pointing at a black hole, and a service bound to
loopback.

**Diagnosis, in the order you should run it:**

```bash
# 1. does the name resolve, and to what?
getent hosts reports.internal
# 203.0.113.42   reports.internal

# 2. does DNS agree?
dig +short reports.internal
# (empty, or a different address)  -> the resolver and DNS disagree

# 3. where does the override come from?
grep reports.internal /etc/hosts
# 203.0.113.42  reports.internal

# 4. is the service actually listening, and on what?
ss -ltnp 'sport = :8080'
# LISTEN 0 5 127.0.0.1:8080 ...      -> loopback only
```

Four commands, and the picture is complete: the name points at an unreachable
documentation address, and the service would not have been reachable from another host
anyway.

**Fix 1 — remove the stale entry:**

```bash
sudo sed -i '/reports.internal/d' /etc/hosts
```

For this local exercise, point it at the loopback address where the service actually
runs:

```bash
echo '127.0.0.1  reports.internal' | sudo tee -a /etc/hosts
getent hosts reports.internal
curl -sS http://reports.internal:8080
```

**Fix 2 — bind to a reachable interface.** In `service.py`:

```python
HTTPServer(("0.0.0.0", 8080), H).serve_forever()
```

Restart it and confirm:

```bash
pkill -f service.py
cd ~/breakfix/net-01/lab && nohup python3 service.py > service.log 2>&1 &
ss -ltnp 'sport = :8080'
# LISTEN 0 5 0.0.0.0:8080
```

The layered model that makes this quick every time:

```
name  ->  address   : DNS / /etc/hosts        (dig, getent, resolvectl)
address -> port     : routing, firewall, NAT  (ping, traceroute, nc -zv)
port  -> service    : the listener            (ss -ltnp, curl)
service -> response : the application         (curl -v, application logs)
```

Test one layer at a time, downward, and each result either localises the fault or
eliminates a layer. The reason the ticket stalled is that ping tests part of layer two
and the reporter used it to draw a conclusion about layer four.

Commands worth having in your fingers:

```bash
dig reports.internal +short          # DNS answer only
dig reports.internal +trace          # full delegation path, for real DNS problems
getent hosts reports.internal        # what the SYSTEM resolves, including /etc/hosts
nc -zv reports.internal 8080         # is the TCP port open? no HTTP involved
curl -v http://reports.internal:8080 # full request, with DNS and connect timings
curl -sS -o /dev/null -w 'dns=%{time_namelookup} connect=%{time_connect} total=%{time_total}\n' URL
```

That last one is excellent for "the site is slow": it breaks the request into phases so
you can see whether the time went to DNS, the TCP handshake, TLS, or the server.

One caution about `/etc/hosts` entries: they are invisible to everyone else and to
every monitoring system. An entry added during an incident to work around a DNS
problem, and never removed, will eventually cause a confusing single-machine failure
months later. If you add one, write it down.

## What You Learned

The reporter had good evidence and drew the wrong conclusion from it, because ping
answers a question nobody was asking. That is the shape of most "it must be the
application" tickets: a tool was run, it produced output, and the output was
interpreted as being about a different layer than it actually tests.

The habit worth building is naming the layer before choosing the tool. If you want to
know about name resolution, use a resolver tool and nothing else. If you want to know
about TCP reachability, open a socket. If you want to know about the service, speak its
protocol. Four commands run in that order will localise almost any connectivity fault
faster than any amount of reasoning about what is probably wrong.
