# curl http:// works on my laptop and talks garbage in the cluster

## Briefing

The ingress only speaks TLS on 443. A health probe and a cron job still use
`http://api.internal/health`. On a laptop with a local HTTP server on 80 that
redirects to HTTPS, the job "works" (it follows the 301). In the cluster there
is no listener on 80, or 80 is a TLS port, and curl prints:

```
malformed HTTP status
```

or hangs until timeout. Someone "fixed" the cron with `curl -k https://...` and
called it done. The probe is still HTTP on a TLS port.

## Your Task

- Show HTTP/1.1 bytes hitting a TLS listener (or empty port 80).
- Switch the client to `https://` on 443 without disabling verification.
- Confirm `curl -vI https://api.internal/health` is HTTP 200 over TLS.

## Starter Files

### file: probe.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# broken: scheme does not match the port
URL="${1:-http://127.0.0.1:8443/health}"
curl -sv --connect-timeout 3 "$URL" || true
```

### file: tls-listener.py

```python
#!/usr/bin/env python3
"""Tiny TLS server so you can see HTTP-on-TLS fail locally."""
import http.server, ssl, sys
httpd = http.server.HTTPServer(("127.0.0.1", 8443), http.server.SimpleHTTPRequestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
# generate with: openssl req -x509 -newkey rsa:2048 -keyout k.pem -out c.pem -days 1 -nodes -subj /CN=localhost
ctx.load_cert_chain(sys.argv[1], sys.argv[2])
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
httpd.serve_forever()
```

## Expected Failure

```bash
# HTTP client, TLS server:
curl -sv http://127.0.0.1:8443/health
# * Connected
# > GET /health HTTP/1.1
# malformed / empty reply / LibreSSL SSL_connect if you flipped it the other way

# or nothing on 80:
curl -sv --connect-timeout 2 http://api.internal/health
# Connection refused
```

Cleartext HTTP and TLS are not interchangeable just because both are "web".

## Expected Outcome

```bash
curl -svI --cacert /path/to/ca.pem https://api.internal/health
# * SSL connection using TLSv1.3
# HTTP/1.1 200 OK
```

Probes and cron use `https://` and a CA they actually trust. `curl -k` is not
in the unit file.

## Hints

### Hint 1 — Read the first bytes

If you send `GET / HTTP/1.1` to a TLS port, the server expects a ClientHello
and closes or returns junk. `openssl s_client -connect host:443 -servername host`
proves TLS; then curl with `https://`.

### Hint 2 — Redirects hide the bug on laptops

A local `:80` that 301s to HTTPS makes `curl http://` succeed (`-L`). Production
ingress may not listen on 80 at all. Probe the same scheme and port as the
ingress definition.

## Solution

Match scheme, port, and verification.

```bash
# prove it is TLS
openssl s_client -connect 127.0.0.1:8443 -servername localhost </dev/null | head

curl -sSI --cacert ca.pem https://127.0.0.1:8443/health
# fix probe.sh / k8s probe / cron:
#   http://...:8443  ->  https://...:8443
#   httpGet port 443 scheme HTTP  ->  scheme HTTPS
```

- **`http://` is not "the same URL with less security".** It is a different
  protocol on a different (default) port.
- **Health probes inherit this bug constantly** in Kubernetes `httpGet`.
- **`-k` hides a second bug** (trust) and should not ship in cron.
- **Test with `curl -vI https://...`** from the same network the probe uses.
