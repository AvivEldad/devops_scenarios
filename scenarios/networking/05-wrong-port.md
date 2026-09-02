# The dashboard is up on the box, curl from my laptop says connection refused

## Briefing

On the server, `curl http://localhost:8080/health` returns 200. From a laptop,
`curl http://reports.internal/health` returns `Connection refused`. The load
balancer, the DNS record, and the runbook all assume port 80.

The operator "fixed" it last week by documenting "use :8080 in the URL." Users
do not do that. The service is healthy and unreachable at the address everyone
actually types.

## Your Task

- Show that the process is listening on 8080 and nothing is on 80.
- Explain why localhost:8080 succeeding does not prove the published URL works.
- Put something on the port the URL implies (proxy, bind, or published mapping)
  so `curl http://127.0.0.1/health` succeeds without a port in the URL.

## Starter Files

### file: app.py

```python
#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"ok\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8080), H).serve_forever()
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
python3 app.py &
sleep 0.3
echo "== what the developer runs =="
curl -sS -o /dev/null -w "localhost:8080 -> %{http_code}\n" http://127.0.0.1:8080/health
echo "== what the user runs =="
curl -sS --connect-timeout 2 http://127.0.0.1/health || true
ss -lnt | grep -E ':80 |:8080 ' || true
kill %1 2>/dev/null || true
```

## Expected Failure

```bash
bash check.sh
# localhost:8080 -> 200
# curl: (7) Failed to connect to 127.0.0.1 port 80: Connection refused
```

The app is fine. Port 80 is empty. HTTP URLs without a port are port 80.

## Expected Outcome

Port 80 serves the app (directly or via a reverse proxy):

```bash
ss -lnt | grep ':80 '
curl -sS http://127.0.0.1/health
# ok
```

`localhost:8080` still works if you keep it as an admin port, but the published
hostname no longer requires a non-default port.

## Hints

### Hint 1 — Default ports are part of the URL

`http://host` is port 80, `https://host` is 443. A process on 8080 is a different
service as far as the client is concerned. Check `ss -lnt` for both.

### Hint 2 — localhost is not the published listener

`curl localhost:8080` bypasses DNS, the load balancer, and the host firewall's
INPUT path for eth0. Prove the published socket: bind `0.0.0.0:80` or put nginx
in front, then curl the hostname from another machine.

## Solution

Listen where the URL points, or put a proxy there.

```bash
ss -lnt
# 127.0.0.1:8080  LISTEN     <- developer check
# (nothing on *:80)          <- user check

# option A: run the app on 80 (needs cap or root)
# option B: reverse proxy (preferred)
# nginx: proxy_pass http://127.0.0.1:8080;
# or socat for a lab:
sudo socat TCP-LISTEN:80,fork,reuseaddr TCP:127.0.0.1:8080
```

- **Healthy on localhost:8080 is not healthy on the product URL.** Test the URL
  users type.
- **Default ports are implicit.** Documenting ":8080" is not a front door.
- **Publish 80/443** with a reverse proxy and keep 8080 on loopback.
- **Containers:** `-p 8080:8080` still leaves host :80 empty. Map `80:8080` or put
  an ingress in front.
