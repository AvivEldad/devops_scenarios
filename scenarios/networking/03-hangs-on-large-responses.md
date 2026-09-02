# Small requests work, large ones hang forever

## Briefing

The `metrics-export` service works perfectly in testing and hangs in production. Not
slowly — completely. The connection establishes, the request is sent, some data
arrives, and then nothing, until something eventually times out thirty minutes later.

The pattern nobody has spotted yet: it depends on the size of the response. Requests
returning a few hundred bytes always succeed. Requests returning more than about
1400 bytes always hang.

The team has retried, restarted, scaled up, and added logging. The service is not the
problem. Something between the client and the server is silently discarding a specific
class of packet, and the failure has been invisible because the two ends never
disagree about anything they can observe.

> Linux, with `sudo` for the network namespace and interface configuration in the
> setup. `tcpdump` is needed for the diagnosis. This is a genuine reproduction of a
> path MTU black hole, not a simulation.

## Your Task

1. Run the setup, which creates a network namespace connected by a link with a reduced
   MTU and blocks the ICMP messages that would normally fix it.
2. Reproduce the size threshold precisely — find the response size at which it breaks.
3. Diagnose it with packet capture. You must be able to point at the packet that is
   never acknowledged.
4. Apply a fix, and then a better fix, and explain the difference.
5. Add the client-side protection that would have turned a thirty-minute hang into a
   ten-second error.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Builds a network namespace whose link has a small MTU, with ICMP fragmentation
# messages dropped -- a classic path MTU black hole.
set -euo pipefail

NS=bfnet
sudo ip netns del "$NS" 2>/dev/null || true

sudo ip netns add "$NS"
sudo ip link add veth-host type veth peer name veth-ns
sudo ip link set veth-ns netns "$NS"

sudo ip addr add 10.77.0.1/24 dev veth-host
sudo ip link set veth-host up

sudo ip netns exec "$NS" ip addr add 10.77.0.2/24 dev veth-ns
sudo ip netns exec "$NS" ip link set veth-ns up
sudo ip netns exec "$NS" ip link set lo up

# the constrained link: 1400 instead of 1500
sudo ip link set veth-host mtu 1400
sudo ip netns exec "$NS" ip link set veth-ns mtu 1400

# THE BLACK HOLE: drop the ICMP message that tells senders to use a smaller packet
sudo iptables -I OUTPUT -p icmp --icmp-type fragmentation-needed -j DROP
sudo iptables -I INPUT  -p icmp --icmp-type fragmentation-needed -j DROP

cat > server.py <<'EOF'
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        size = int(q.get("size", ["100"])[0])
        body = (b"x" * size) + b"\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *a):
        print("request %s" % (fmt % a), flush=True)

print("metrics-export listening on 0.0.0.0:8080", flush=True)
HTTPServer(("0.0.0.0", 8080), H).serve_forever()
EOF

sudo cp server.py /tmp/bfnet-server.py
sudo ip netns exec "$NS" bash -c \
  'nohup python3 /tmp/bfnet-server.py > /tmp/bfnet-server.log 2>&1 &'
sleep 1

cat > teardown.sh <<'EOF'
#!/usr/bin/env bash
sudo iptables -D OUTPUT -p icmp --icmp-type fragmentation-needed -j DROP 2>/dev/null
sudo iptables -D INPUT  -p icmp --icmp-type fragmentation-needed -j DROP 2>/dev/null
sudo ip netns del bfnet 2>/dev/null
sudo ip link del veth-host 2>/dev/null
echo "teardown complete"
EOF
chmod +x teardown.sh

echo "ready. server at http://10.77.0.2:8080/?size=N"
echo "run ./teardown.sh when finished"
```

### file: client.py

```python
#!/usr/bin/env python3
"""Fetches a metrics export. No timeout, no retry, no size limit."""
import sys
import urllib.request

size = sys.argv[1] if len(sys.argv) > 1 else "100"
url = "http://10.77.0.2:8080/?size=%s" % size

print("fetching %s" % url, flush=True)
with urllib.request.urlopen(url) as resp:
    data = resp.read()
print("received %d bytes" % len(data))
```

## Expected Failure

```bash
bash setup.sh
```

Small responses are fine:

```bash
python3 client.py 100
# fetching http://10.77.0.2:8080/?size=100
# received 101 bytes

python3 client.py 1000
# received 1001 bytes
```

Cross the threshold and it stops dead:

```bash
python3 client.py 5000
# fetching http://10.77.0.2:8080/?size=5000
# ... hangs indefinitely, no error, no output
```

Ping works perfectly, which is why nobody suspected the network:

```bash
ping -c 3 10.77.0.2
# 3 packets transmitted, 3 received, 0% packet loss
```

And the server believes it succeeded:

```bash
sudo cat /tmp/bfnet-server.log
# request "GET /?size=5000 HTTP/1.1" 200 -
```

Both ends think everything is fine. The server wrote the response and moved on; the
client is waiting for bytes that will never arrive. There is no error anywhere to log,
which is precisely why this survived so long.

## Expected Outcome

Large responses must transfer, and a failure must surface quickly rather than hanging.

**The threshold is identified.** You can state the size at which it breaks and why
that number:

```bash
for n in 1300 1340 1360 1400 2000; do
  printf '%-6s ' "$n"
  timeout 5 python3 client.py "$n" >/dev/null 2>&1 && echo OK || echo HANG
done
```

**Large transfers succeed after the fix:**

```bash
python3 client.py 5000
# received 5001 bytes

python3 client.py 100000
# received 100001 bytes
```

**You have packet evidence.** A capture taken during a failing transfer shows a
full-size segment retransmitted repeatedly with no acknowledgement:

```bash
sudo tcpdump -ni veth-host -c 20 'host 10.77.0.2 and tcp'
# repeated identical large segments, no corresponding ACK
```

**The client fails fast instead of hanging.** Even with the network fault reinstated,
the client must return an error within seconds:

```bash
# after re-enabling the black hole
timeout 30 python3 client.py 5000; echo "exit=$?"
# a clear timeout error, exit non-zero, in ~10s -- NOT a 30s kill by `timeout`
```

**Small requests are unaffected** by whatever you changed:

```bash
python3 client.py 100
# received 101 bytes
```

**The route or interface reflects your fix:**

```bash
ip route get 10.77.0.2
# shows the mtu you set, if you fixed it via routing
# or
ip link show veth-host | grep mtu
```

Clean up:

```bash
./teardown.sh
```

## Hints

### Hint 1 — The threshold is the clue, and it is not arbitrary

Test methodically and find the boundary. It will sit just under 1400 bytes of total
packet size, which is the MTU of the link.

Standard Ethernet MTU is 1500 bytes. Subtract 20 bytes of IP header and 20 of TCP
header and you get an MSS of 1460 bytes of payload. Any technology that adds
encapsulation — VPNs, VXLAN, IPsec, PPPoE, some cloud overlay networks — reduces the
usable MTU, and 1400 is a very common result.

A size-dependent hang is almost always MTU. Nothing else produces a clean threshold
like this.

### Hint 2 — Confirm it directly with ping

`ping` can send a specific payload size with the do-not-fragment bit set, which tests
exactly what TCP is running into:

```bash
ping -c 2 -M do -s 1300 10.77.0.2    # 1300 + 28 = 1328 bytes, fits
ping -c 2 -M do -s 1450 10.77.0.2    # 1478 bytes, too big
```

The second should report `Frag needed and DF set (mtu = 1400)` — or, in a black hole,
simply time out with no message at all. That silence is the diagnosis: the router is
discarding the packet and the ICMP notification is not reaching you.

Binary search with `-s` to find the exact largest payload that passes, then add 28 for
the ICMP and IP headers to get the path MTU.

### Hint 3 — Watch the retransmissions

```bash
sudo tcpdump -ni veth-host -v 'host 10.77.0.2 and tcp'
```

Run a failing request and read the capture. You will see the handshake complete
normally, small packets flow, and then one large segment sent again and again at
increasing intervals, never acknowledged.

That pattern — successful handshake, then a single unacknowledged full-size segment
retransmitted with exponential backoff — is the signature of a path MTU black hole.
The connection is not refused or reset, so every application-level check reports
health.

### Hint 4 — Why "path MTU discovery" did not save you

TCP normally handles this automatically. The sender marks packets do-not-fragment; a
router that cannot forward one replies with ICMP type 3 code 4
(`fragmentation needed`); the sender reduces its segment size and retries.

The whole mechanism depends on that ICMP message arriving. The setup drops it, and so
do a great many real firewalls configured by someone who decided "block all ICMP" was
good security. The result is a silent black hole rather than an automatic adjustment.

This is the single best reason not to blanket-block ICMP.

### Hint 5 — Two fixes, and a third that is not really a fix

- **Set the correct MTU** on the interface or route, so the sender never generates
  oversized packets:
  `sudo ip link set veth-host mtu 1400`
  or per-route: `sudo ip route change 10.77.0.0/24 dev veth-host mtu 1400`
- **Clamp the MSS**, which is what routers and VPN gateways do. It rewrites the MSS in
  the TCP handshake so both ends negotiate a segment size that fits:
  `sudo iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu`
- **Stop blocking the ICMP**, which restores the automatic mechanism and is the real
  root-cause fix where you control the firewall.

Separately, and regardless of the network fix: the client has no timeout. That is an
application defect which turned a network fault into an indefinite hang.

## Solution

A link with a 1400-byte MTU, and the ICMP messages that would have told the sender
about it are being dropped.

**Diagnosis:**

```bash
# 1. find the threshold
for n in 1200 1300 1350 1400 1500; do
  printf '%-6s ' "$n"; timeout 5 python3 client.py "$n" >/dev/null 2>&1 && echo OK || echo HANG
done

# 2. confirm the path MTU directly
ping -c 2 -M do -s 1372 10.77.0.2   # 1400 total: passes
ping -c 2 -M do -s 1373 10.77.0.2   # 1401 total: silence

# 3. see the retransmissions
sudo tcpdump -ni veth-host -c 20 'host 10.77.0.2 and tcp' &
python3 client.py 5000 &
sleep 5; sudo pkill tcpdump
```

**Fix 1 — correct the MTU so oversized packets are never generated:**

```bash
sudo ip route change 10.77.0.0/24 dev veth-host mtu 1400 2>/dev/null || \
  sudo ip route add 10.77.0.0/24 dev veth-host mtu 1400

ip route get 10.77.0.2
python3 client.py 5000
# received 5001 bytes
```

**Fix 2 — the root cause: stop dropping the ICMP:**

```bash
sudo iptables -D OUTPUT -p icmp --icmp-type fragmentation-needed -j DROP
sudo iptables -D INPUT  -p icmp --icmp-type fragmentation-needed -j DROP
```

With path MTU discovery working again, the network adapts on its own and no per-route
configuration is needed. This is the better fix because it fixes every destination,
not just the one you noticed.

**Fix 3 — the application defect.** A network will fail again; the client must not
hang when it does:

```python
#!/usr/bin/env python3
"""Fetches a metrics export, with bounded time and a clear failure."""
import socket
import sys
import urllib.error
import urllib.request

TIMEOUT_SECONDS = 10
MAX_BYTES = 50 * 1024 * 1024


def fetch(size):
    url = "http://10.77.0.2:8080/?size=%s" % size
    print("fetching %s" % url, flush=True)
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as resp:
            length = resp.headers.get("Content-Length")
            if length and int(length) > MAX_BYTES:
                raise ValueError("response too large: %s bytes" % length)
            data = resp.read(MAX_BYTES + 1)
    except socket.timeout:
        print("error: no data for %ds - the transfer stalled mid-stream"
              % TIMEOUT_SECONDS, file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print("error: %s" % exc.reason, file=sys.stderr)
        return 1

    if len(data) > MAX_BYTES:
        print("error: response exceeded %d bytes" % MAX_BYTES, file=sys.stderr)
        return 1

    print("received %d bytes" % len(data))
    return 0


if __name__ == "__main__":
    sys.exit(fetch(sys.argv[1] if len(sys.argv) > 1 else "100"))
```

Note that `timeout` on a socket is an **inactivity** timeout, not a total-duration
one — it fires when no data arrives for that long, which is exactly the stall in this
scenario. For a total budget you need your own deadline around the read loop, and for
`requests` the equivalent is `timeout=(connect, read)`.

The concepts, in the order they matter:

- **MTU is the largest frame a link will carry; MSS is the TCP payload that fits inside
  it.** MSS is negotiated in the SYN and is typically MTU minus 40 for IPv4.
- **Path MTU discovery is the automatic adjustment mechanism**, and it depends entirely
  on ICMP type 3 code 4 being deliverable. Blanket ICMP blocking breaks it and creates
  black holes that are extremely hard to attribute.
- **A size-dependent hang is MTU until proven otherwise.** Small requests working while
  large ones fail is a nearly unique signature.
- **Where else you will meet this:** VPNs (typically 1400 or less), Kubernetes CNI
  overlays like VXLAN (1450), IPsec, PPPoE (1492), and cloud jumbo-frame networks where
  one hop does not support 9000. It is why some pod-to-pod traffic works and some
  hangs, in a cluster that otherwise looks healthy.

## What You Learned

Every layer reported success. The TCP connection established, the server logged a 200,
ping had zero loss, and the client sat waiting for data that a router had silently
discarded. There was no error to find because no component believed anything had gone
wrong — the loss happened between them, and the mechanism designed to report it had
been deliberately blocked.

Two things to carry away. First, when a failure correlates with size rather than time,
frequency or endpoint, suspect MTU immediately and confirm with `ping -M do -s`; it is
a two-command diagnosis once you recognise the shape. Second, no matter what the
network does, an application without a timeout converts any packet loss into an
indefinite hang — so the client defect here was arguably the more serious of the two,
because it is the reason a thirty-minute outage produced no alert.
