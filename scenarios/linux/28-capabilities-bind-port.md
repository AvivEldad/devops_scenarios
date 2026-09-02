# The service that cannot bind port 80 without root

## Briefing

An app needs to listen on port 80 (or 443). It works when run as root, and fails with
`Permission denied` as a normal user. The team's answer is to run the whole service as root —
a large, unnecessary security exposure for one capability.

Binding to ports below 1024 requires the `CAP_NET_BIND_SERVICE` capability, historically only
held by root. But Linux capabilities let you grant *just that one power* to a binary (or a
systemd service) without making it root — and there are cleaner options still (a reverse
proxy, or lowering the privileged-port threshold).

## Your Task

- Reproduce `Permission denied` binding a low port as a non-root user.
- Explain Linux capabilities and why "run as root" is the wrong fix.
- Let the service bind port 80 with least privilege.

## Starter Files

### file: server.py

```python
# Minimal server that binds a port from argv. Run as non-root against port 80 to see it fail.
import http.server, socketserver, sys
port = int(sys.argv[1]) if len(sys.argv) > 1 else 80
with socketserver.TCPServer(("", port), http.server.SimpleHTTPRequestHandler) as httpd:
    print(f"listening on :{port}")
    httpd.serve_forever()
```

## Expected Failure

```bash
# as a normal user:
python3 server.py 80
# PermissionError: [Errno 13] Permission denied
```

```bash
# it works on a high port, or as root - proving it is the privileged-port rule, not the code:
python3 server.py 8080
# listening on :8080

sudo python3 server.py 80
# listening on :80        <- works, but now the whole app runs as root
```

Ports below 1024 are privileged; binding one needs `CAP_NET_BIND_SERVICE`. As a normal user
the bind is denied; as root it succeeds — but running the entire service as root to gain one
capability exposes everything else the process does to that privilege.

## Expected Outcome

The service binds port 80 as a non-root user, with only the capability it needs.

The binary/interpreter (or the service) has `CAP_NET_BIND_SERVICE` and nothing more:

```bash
getcap "$(readlink -f "$(command -v python3)")"
# /usr/bin/python3.x = cap_net_bind_service+ep
```

It binds 80 without sudo:

```bash
python3 server.py 80
# listening on :80        <- as a normal user
```

Or, better for a real deployment, systemd grants the capability to the service alone:

```bash
systemctl show myapp -p AmbientCapabilities,User
# AmbientCapabilities=CAP_NET_BIND_SERVICE
# User=appuser                                 <- runs unprivileged, binds 80
```

## Hints

### Hint 1 — Low ports need a capability, not full root

Ports < 1024 require `CAP_NET_BIND_SERVICE`. Root has it by default, which is why "run as
root" works — but that grants every other capability too. Capabilities split root's powers
into units you can grant individually. `getcap`/`setcap` manage them on files; systemd manages
them per-service.

### Hint 2 — Grant the minimum, or avoid the low port entirely

Cleanest options, best first:
- Put a reverse proxy (nginx/haproxy) on 80/443 and let the app listen on a high port — the
  app never needs the capability.
- systemd service: `AmbientCapabilities=CAP_NET_BIND_SERVICE` (+ `User=appuser`) grants only
  that power to that service.
- `sudo setcap 'cap_net_bind_service=+ep' /path/to/binary` grants it on the binary itself
  (note: for interpreted apps this applies to the interpreter, which is broad — prefer systemd).
- Or lower the threshold: `sysctl net.ipv4.ip_unprivileged_port_start=80` (blunt; affects all
  users).

## Solution

Bind the low port with least privilege — prefer a proxy or a per-service capability over
setcap-on-interpreter, and never run the whole app as root for this.

```bash
# Preferred for real deployments: systemd grants only the needed capability
# /etc/systemd/system/myapp.service
#   [Service]
#   User=appuser
#   AmbientCapabilities=CAP_NET_BIND_SERVICE
#   ExecStart=/usr/bin/python3 /opt/myapp/server.py 80
sudo systemctl daemon-reload && sudo systemctl restart myapp

# Also clean: a reverse proxy on 80, app on a high port (app needs NO capability)
#   nginx listens on 80/443 -> proxy_pass http://127.0.0.1:8080

# Quick/standalone (broad for interpreters - use with care):
sudo setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(command -v python3)")"
getcap "$(readlink -f "$(command -v python3)")"
python3 server.py 80        # binds as non-root
```

- **Privileged ports (<1024) need `CAP_NET_BIND_SERVICE`**, not full root. Running the whole
  service as root to get one capability hands an attacker every other capability if the process
  is compromised.
- **Linux capabilities split root into grantable units.** `getcap`/`setcap` manage them on
  executables; systemd `AmbientCapabilities=` grants them per-service alongside `User=` so the
  process runs unprivileged yet can bind 80.
- **Prefer a reverse proxy** for public 80/443: the app listens high and needs no special
  privilege at all, and you get TLS termination, routing, and rate limiting for free.
- **`setcap` on an interpreter is broad.** Granting `cap_net_bind_service` to `python3` gives
  it to *every* python program on the box. For interpreted apps, the per-service systemd grant
  is tighter and safer than setcap.
- **`ip_unprivileged_port_start` lowers the threshold globally** — simple but blunt, affecting
  all users and processes. Reach for it only when the per-service options do not fit.
