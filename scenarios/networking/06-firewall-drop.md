# ss shows it listening, curl from the other subnet times out

## Briefing

The process is running. `ss -lnt` on the server shows `0.0.0.0:8443`. Local curl
works. Curl from the app subnet times out. Security groups were "opened". Someone
added a host firewall later and nobody put 8443 in it.

The ticket is still on the application team because the port is listening.

## Your Task

- Distinguish "listening" from "reachable from this client".
- Find a host firewall rule that drops 8443 from off-box while allowing
  localhost.
- Open the port for the real source and confirm a remote-style curl succeeds.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# lab approximation: iptables DROP on a high port unless source is loopback
PORT="${PORT:-18443}"
python3 - <<PY &
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok\n")
    def log_message(self, *a):
        pass
HTTPServer(("0.0.0.0", int("$PORT")), H).serve_forever()
PY
sleep 0.2
# requires sudo in a real drill; printed here so you can apply it
cat <<RULES
# sudo iptables -I INPUT -p tcp --dport $PORT ! -i lo -j DROP
# local curl still works; curl from another host times out
RULES
echo "listener:"; ss -lnt | grep ":$PORT " || true
```

## Expected Failure

```bash
# on the server
curl -sS --connect-timeout 2 http://127.0.0.1:18443/
# ok
ss -lnt | grep 18443
# 0.0.0.0:18443 LISTEN

# from another host (or after the DROP rule)
curl -sS --connect-timeout 3 http://<server>:18443/
# curl: (28) Connection timed out
```

Listening is not the same as accepting packets from this source.

## Expected Outcome

The INPUT (or nft `filter input`) path allows tcp/18443 from the app subnet,
and a curl that does not use localhost succeeds:

```bash
curl -sS --connect-timeout 3 http://<server-ip>:18443/
# ok
```

The rule is documented next to the service, not only in a chat message.

## Hints

### Hint 1 — Local curl never hits INPUT the way eth0 does

Traffic to `127.0.0.1` uses the loopback path. Traffic to the NIC address hits
`INPUT` (and, in front of that, cloud security groups and network ACLs). Test
with the server's real IP from another namespace or host: `curl http://<eth0-ip>:port`.

### Hint 2 — DROP vs REJECT

`DROP` → client timeout. `REJECT` → connection refused. If `ss` shows a listener
and the client times out, look for DROP/nft drop, a security group, or a network
ACL — not a crashed process. `iptables -L INPUT -n -v` and `nft list ruleset`.

## Solution

Open the host firewall for the real source, then retest from off-box.

```bash
ss -lnt 'sport = :18443'          # listening is necessary, not sufficient
sudo iptables -L INPUT -n -v --line-numbers
sudo nft list ruleset
# cloud: security group ingress + NACL + host iptables, in that order of "who drops first"

# fix (example)
sudo iptables -D INPUT -p tcp --dport 18443 ! -i lo -j DROP
# or: sudo ufw allow 18443/tcp from 10.4.0.0/16
```

- **Three filters stack:** cloud SG/NACL, host firewall, then the process.
  Any one DROP produces a timeout.
- **Always curl the NIC address**, not only localhost.
- **Prefer REJECT in labs** so a mis-deny is obvious; production often uses DROP.
- **Persist the rule** (`iptables-save`, nft, ufw) or the next reboot "breaks"
  the service again.
