# The certificate is valid and curl still says the name does not match

## Briefing

`echo | openssl s_client -connect 10.4.12.80:443` shows a leaf issued by the
corporate CA, not expired, chain complete. `curl https://10.4.12.80/` fails
hostname check. `curl https://api.prd.example/` sometimes shows a certificate
for `api.stg.example` instead.

Two different bugs get collapsed into "cert is wrong":

1. You connected by IP, and the SAN has only DNS names.
2. You connected by name, but the TCP connection hit a vhost that presented
   another certificate because SNI was missing or wrong.

This is not the intercepting-proxy incident. The CA is fine. The name in the
handshake is not the name you asked for.

## Your Task

- Extract SANs from the certificate you actually received.
- Show curl-by-IP failing hostname verification.
- Send SNI (`-servername`) that matches a SAN, and curl the hostname (not
  the IP) so verification succeeds.

## Starter Files

### file: inspect.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
HOST="${1:-127.0.0.1}"
PORT="${2:-443}"
echo "== what the server presents to this TCP destination =="
echo | openssl s_client -connect "${HOST}:${PORT}" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null || true
echo
echo "curl by IP uses the IP as the hostname for verification:"
echo "  curl -sv https://${HOST}/"
```

## Expected Failure

```bash
curl -sv https://10.4.12.80/
# SSL: no alternative certificate subject name matches target host name '10.4.12.80'

# or, missing/wrong SNI on a multi-cert LB:
curl -sv https://api.prd.example/
# SSL: certificate subject name 'api.stg.example' does not match target host name 'api.prd.example'
```

The CA trusted the cert. The identity did not match the request.

## Expected Outcome

```bash
echo | openssl s_client -connect 10.4.12.80:443 -servername api.prd.example \
  | openssl x509 -noout -ext subjectAltName
# DNS:api.prd.example

curl -sSI --resolve api.prd.example:443:10.4.12.80 https://api.prd.example/health
# HTTP/1.1 200 OK
```

Clients use the DNS name. Load balancers select the certificate from SNI.

## Hints

### Hint 1 — IP is not a DNS SAN

Unless the certificate has `IP:10.4.12.80` in SAN, `https://10.4.12.80` must
fail hostname checks. Use `--resolve name:443:ip` to pin the address without
lying about the name.

### Hint 2 — SNI chooses the cert

`openssl s_client -connect ip:443` with no `-servername` may return the
default vhost cert. Always pass `-servername api.prd.example` when inspecting.
nginx `server_name`, AWS ALN, and Traefik all key off SNI.

## Solution

Verify the name you intend, and send that name as SNI.

```bash
echo | openssl s_client -connect 10.4.12.80:443 -servername api.prd.example \
  | openssl x509 -noout -ext subjectAltName

curl -sSI --resolve api.prd.example:443:10.4.12.80 https://api.prd.example/
# LB: default_ssl_certificate / extra server { listen 443 ssl; server_name api.prd... }
```

- **Trust and identity are separate checks.** A trusted cert can still be
  the wrong name.
- **Do not curl HTTPS by IP** unless the SAN contains that IP.
- **`--resolve`** is how you test a specific backend without editing hosts.
- **SNI mismatches** look like "we deployed the staging cert to prod" even
  when both certs are on the same VIP.
