# Certificate errors behind the corporate proxy

## Briefing

A build that works on your laptop fails inside the corporate network with an error
that looks like a security incident:

```
SSL: CERTIFICATE_VERIFY_FAILED - unable to get local issuer certificate
```

Someone has already pasted the "fix" into the team chat: `curl -k`, `verify=False`,
and `PIP_TRUSTED_HOST`. Several people have applied it. Those changes are now in three
repositories and one production deployment script.

They are not a fix. They disable the only mechanism that tells you whether you are
talking to the right server, on a network where something is deliberately intercepting
TLS. The correct fix is to trust the interceptor's certificate authority explicitly.

There are also two connectivity faults underneath the certificate problem, and one of
them will break your access to internal services once the proxy is configured.

> Works on any Linux machine. The scenario simulates a corporate proxy locally so you
> do not need a real one, but every technique applies directly to the real thing.

## Your Task

1. Run the setup, which puts a proxy in your environment and gives you a private CA.
2. Reproduce the certificate failure.
3. Fix it properly — the tool must verify the certificate and succeed, with no
   verification disabled anywhere.
4. Fix the two connectivity faults: internal hosts must bypass the proxy, and the
   proxy configuration must apply to the tools that need it.
5. Be able to explain what a TLS-inspecting proxy actually does, and why `-k` is
   dangerous rather than merely untidy.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Simulates a corporate TLS-inspecting proxy and an internal service.
set -euo pipefail

rm -rf lab && mkdir lab && cd lab

# --- a private CA, standing in for the corporate root CA ---
openssl req -x509 -newkey rsa:2048 -sha256 -days 30 -nodes \
  -keyout corp-ca.key -out corp-ca.crt \
  -subj "/CN=Corp Root CA" 2>/dev/null

# --- a server certificate signed by that CA ---
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=internal.example" 2>/dev/null
printf "subjectAltName=DNS:internal.example,DNS:localhost,IP:127.0.0.1" > san.ext
openssl x509 -req -in server.csr -CA corp-ca.crt -CAkey corp-ca.key \
  -CAcreateserial -out server.crt -days 30 -sha256 -extfile san.ext 2>/dev/null

# --- an HTTPS service using that certificate ---
cat > tls-service.py <<'EOF'
import ssl
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"internal service ok\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, fmt, *a):
        print("request %s" % (fmt % a), flush=True)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain("server.crt", "server.key")
srv = HTTPServer(("127.0.0.1", 8443), H)
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
print("tls service on https://127.0.0.1:8443", flush=True)
srv.serve_forever()
EOF

nohup python3 tls-service.py > tls-service.log 2>&1 &
disown || true
sleep 1

cat > client.py <<'EOF'
#!/usr/bin/env python3
"""Fetches the internal service. Currently fails certificate verification."""
import requests

resp = requests.get("https://127.0.0.1:8443/", timeout=5)
print(resp.status_code, resp.text.strip())
EOF

cat > proxy-env.sh <<'EOF'
# source this to simulate the corporate proxy environment
export http_proxy="http://proxy.corp.invalid:3128"
export https_proxy="http://proxy.corp.invalid:3128"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"
EOF

echo "lab ready in $(pwd)"
echo "  CA:      corp-ca.crt"
echo "  service: https://127.0.0.1:8443"
```

### file: requirements.txt

```text
requests==2.32.3
```

## Expected Failure

```bash
bash setup.sh
cd lab
python3 -m venv .venv && .venv/bin/pip install -q requests
```

**Failure 1 — certificate verification:**

```bash
.venv/bin/python client.py
```

```
requests.exceptions.SSLError: HTTPSConnectionPool(host='127.0.0.1', port=8443):
Max retries exceeded with url: /
(Caused by SSLError(SSLCertVerificationError(1,
'[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed:
unable to get local issuer certificate (_ssl.c:1006)')))
```

The same from curl:

```bash
curl -sS https://127.0.0.1:8443/
# curl: (60) SSL certificate problem: unable to get local issuer certificate
```

The server's certificate is signed by `Corp Root CA`, which is not in any default
trust store. Every tool correctly refuses to trust it.

**Failure 2 — the proxy swallows internal traffic:**

```bash
source ../proxy-env.sh
curl -sS --max-time 5 https://127.0.0.1:8443/
# curl: (5) Could not resolve proxy: proxy.corp.invalid
```

Now even the loopback request is being sent to a proxy that does not exist, because
`https_proxy` applies to everything without exception.

## Expected Outcome

Verification must succeed, not be bypassed.

**curl trusts the CA and connects:**

```bash
curl -sS --cacert corp-ca.crt https://127.0.0.1:8443/
# internal service ok
```

**Python trusts it too**, with no `verify=False` anywhere:

```bash
.venv/bin/python client.py
# 200 internal service ok

grep -rn 'verify=False\|verify = False' client.py
# (no output)
```

**Nothing disables verification anywhere in the lab:**

```bash
grep -rniE 'insecure|verify=false|trusted-host|curl -k|-k ' *.py *.sh 2>/dev/null | grep -v '^Binary'
# no results that disable TLS verification
```

**The internal host bypasses the proxy** while the proxy still applies to external
traffic:

```bash
source ../proxy-env.sh
export no_proxy="127.0.0.1,localhost,.internal,.example"
export NO_PROXY="$no_proxy"

curl -sS --cacert corp-ca.crt --max-time 5 https://127.0.0.1:8443/
# internal service ok        <- bypassed the proxy

curl -sS --max-time 5 -o /dev/null -w '%{http_code}\n' https://example.com
# fails with a proxy error, proving the proxy IS still applied externally
```

**The CA is trusted system-wide**, so every tool benefits rather than each one being
special-cased:

```bash
# after installing the CA
curl -sS https://127.0.0.1:8443/          # no --cacert needed
# internal service ok

python3 -c "import ssl,socket; ctx=ssl.create_default_context(); s=ctx.wrap_socket(socket.create_connection(('127.0.0.1',8443)), server_hostname='localhost'); print('verified:', s.getpeercert() is not None)"
# verified: True
```

**You can read the certificate chain and name the issuer:**

```bash
openssl s_client -connect 127.0.0.1:8443 -showcerts </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
# issuer=CN = Corp Root CA
# subject=CN = internal.example
```

Clean up:

```bash
pkill -f tls-service.py
```

## Hints

### Hint 1 — Understand what the error is telling you

`unable to get local issuer certificate` means: the server presented a certificate,
your client walked the chain looking for a trusted root, and did not find one in its
trust store. It is not saying the certificate is invalid or expired. It is saying
*"I do not know who signed this"*.

On a corporate network this is usually because a TLS-inspecting proxy terminates the
connection, decrypts it, and re-encrypts with its own certificate signed by the
company's private CA. Your traffic is genuinely being intercepted — with authorisation
— and your client is correctly reporting that it cannot verify the peer.

The fix is to tell your client that this CA is legitimate. Not to stop checking.

### Hint 2 — Why `-k` and `verify=False` are dangerous

Disabling verification does not just skip an annoying check. It means your client will
accept **any** certificate from **any** party that can intercept the connection. You
lose the ability to distinguish the authorised corporate proxy from an attacker on a
café network, which is precisely the distinction TLS exists to make.

It is also sticky in the worst way: `verify=False` written during a proxy problem in
2023 will still be in the production deployment script in 2026, silently accepting
anything, long after anyone remembers why it is there.

### Hint 3 — Point the tool at the CA, then trust it system-wide

Per-tool, useful for testing:

```bash
curl --cacert corp-ca.crt https://...
```

```python
requests.get(url, verify="/path/to/corp-ca.crt", timeout=5)
```

```bash
export REQUESTS_CA_BUNDLE=/path/to/corp-ca.crt   # requests, and pip
export SSL_CERT_FILE=/path/to/corp-ca.crt        # OpenSSL-based tools
export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.crt  # Node.js
```

System-wide, which is the real answer on a corporate machine:

```bash
# Debian / Ubuntu
sudo cp corp-ca.crt /usr/local/share/ca-certificates/corp-ca.crt
sudo update-ca-certificates

# RHEL / Fedora
sudo cp corp-ca.crt /etc/pki/ca-trust/source/anchors/corp-ca.crt
sudo update-ca-trust
```

Note that Python's `requests` bundles its own CA store via `certifi` and does **not**
automatically use the system store, which is why it keeps failing after `curl` starts
working. That surprise is worth remembering.

### Hint 4 — `no_proxy` is what makes internal traffic work

Once `https_proxy` is set, every request goes to the proxy, including ones to
`localhost` and internal hosts the proxy cannot reach.

```bash
export no_proxy="localhost,127.0.0.1,.internal,.corp,10.0.0.0/8"
export NO_PROXY="$no_proxy"
```

Two things that catch people out: the syntax is inconsistent between tools (some
support CIDR, some only suffix matching, some need a leading dot for subdomains), and
many tools read only the lowercase or only the uppercase variant — so set both.

### Hint 5 — Inspect the actual chain

Stop guessing what the server is presenting:

```bash
openssl s_client -connect host:443 -servername host </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates

# the full chain and verification result
openssl s_client -connect host:443 -showcerts </dev/null

# verify against a specific CA
openssl verify -CAfile corp-ca.crt server.crt
```

If `issuer` is your corporate CA on a request to a public site, you have confirmed TLS
inspection. The `-servername` flag sets SNI, which matters because a server hosting
many sites picks its certificate based on it — omitting it is a common source of
"wrong certificate" confusion.

## Solution

One certificate-trust problem, one proxy-scope problem, and a tool-specific trap.

**Fix 1 — install the CA into the system trust store:**

```bash
cd ~/breakfix/net-02/lab
sudo cp corp-ca.crt /usr/local/share/ca-certificates/corp-ca.crt
sudo update-ca-certificates

curl -sS https://127.0.0.1:8443/
# internal service ok
```

**Fix 2 — make Python use it.** `requests` uses `certifi`, not the system store:

```bash
export REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
.venv/bin/python client.py
# 200 internal service ok
```

or make the client explicit about it, which is better for a script that must run
anywhere:

```python
#!/usr/bin/env python3
"""Fetches the internal service, verifying against the corporate CA."""
import os
import requests

# honour an explicit bundle if provided, otherwise the system store
CA_BUNDLE = os.environ.get("REQUESTS_CA_BUNDLE", "/etc/ssl/certs/ca-certificates.crt")

resp = requests.get("https://127.0.0.1:8443/", verify=CA_BUNDLE, timeout=5)
resp.raise_for_status()
print(resp.status_code, resp.text.strip())
```

**Fix 3 — scope the proxy correctly:**

```bash
cat > proxy-env.sh <<'EOF'
export http_proxy="http://proxy.corp.invalid:3128"
export https_proxy="http://proxy.corp.invalid:3128"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"

# never proxy loopback or internal names
export no_proxy="localhost,127.0.0.1,::1,.internal,.corp,.svc,.cluster.local,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
export NO_PROXY="$no_proxy"
EOF
```

What a TLS-inspecting proxy actually does, since this is the concept everything else
hangs off:

```
without inspection:
  client ----------- encrypted, end to end ----------> server
          (verifies the server's real certificate)

with inspection:
  client --- encrypted --> proxy --- encrypted ---> server
          (verifies a certificate the PROXY generated,
           signed by the corporate CA)
```

The proxy holds a CA whose certificate is installed on every managed machine, and mints
a certificate for each site on the fly. Your client sees `CN=example.com` issued by
`Corp Root CA`. If that CA is in your trust store, verification succeeds and everything
works normally. If not, you get exactly the error in this scenario — and disabling
verification "solves" it by making your client accept any impersonation at all.

Environment variables worth knowing, because each ecosystem has its own:

| Variable | Used by |
|---|---|
| `SSL_CERT_FILE`, `SSL_CERT_DIR` | OpenSSL, curl, most C-based tools |
| `REQUESTS_CA_BUNDLE` | Python `requests`, and `pip` |
| `CURL_CA_BUNDLE` | curl |
| `NODE_EXTRA_CA_CERTS` | Node.js (adds to, rather than replaces, the built-in store) |
| `GIT_SSL_CAINFO` | git |
| `AWS_CA_BUNDLE` | AWS CLI and SDKs |

For containers, the CA must be added inside the image — the host's trust store is not
shared. That is a routine addition to a corporate base image:

```dockerfile
COPY corp-ca.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates
```

And for Java, which uses its own keystore entirely rather than any of the above:

```bash
keytool -importcert -alias corp-ca -file corp-ca.crt \
  -keystore "$JAVA_HOME/lib/security/cacerts" -storepass changeit
```

## What You Learned

The error was a security control doing its job, and the widely-shared workaround
disabled it permanently across several repositories. That pattern — a correct warning,
an easy suppression, and a copy-paste culture — is how organisations end up with
production code that accepts any certificate from anyone.

The rule is that a verification failure is a question about trust, and the answer is
always to establish trust explicitly rather than to stop asking. Practically, that
means installing the CA once at the system level and knowing which of your tools
ignore the system store, because the ones that do are exactly where someone will
otherwise reach for `verify=False`.
