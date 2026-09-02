# openssl s_client says verify return code 0 and the browser still warns

## Briefing

The leaf verifies against the corporate CA in `openssl s_client`. Chrome
still shows `NET::ERR_CERT_COMMON_NAME_INVALID`. The certificate's
`Subject CN=*.prd.example` looks right to a human. The SAN list is
`DNS:stg.prd.example` only — a leftover from the CSR template.

Browsers (and Go, Java 7+, curl with NSS/OpenSSL modern policy) ignore CN
when SAN is present. A pretty CN with a wrong SAN is a failed hostname
check. This is not expiry, not an intercepting proxy, and not a missing
intermediate — those are different screens.

## Your Task

- Print CN and SAN and notice they disagree.
- Reproduce curl hostname failure against that cert.
- Issue or install a certificate whose SAN contains the exact names clients
  use (`api.prd.example`, plus the wildcard if you really need it).

## Starter Files

### file: bad.cnf

```
[req]
distinguished_name = req
[req]
CN = *.prd.example
[v3_req]
subjectAltName = DNS:stg.prd.example
# clients will NOT treat CN as a fallback for api.prd.example
```

### file: inspect.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
CERT="${1:-leaf.pem}"
openssl x509 -in "$CERT" -noout -subject -ext subjectAltName
echo
echo "If SAN exists, hostname matching uses SAN only."
```

## Expected Failure

```bash
openssl x509 -in leaf.pem -noout -subject -ext subjectAltName
# subject=CN = *.prd.example
# DNS:stg.prd.example

curl -sv --cacert corp-ca.pem https://api.prd.example/
# SSL: no alternative certificate subject name matches target host name 'api.prd.example'
```

`verify return code: 0` in s_client only means the chain is trusted, if you
did not also request the right servername/hostname check.

## Expected Outcome

```bash
openssl x509 -in leaf.pem -noout -ext subjectAltName
# DNS:api.prd.example
# DNS:*.prd.example          # optional, and *.prd.example does NOT cover a.b.prd.example

curl -sSI --cacert corp-ca.pem https://api.prd.example/health
# HTTP/1.1 200 OK
```

## Hints

### Hint 1 — SAN is the hostname list

RFC 6125 / CA-browser forum: if SAN is present, CN is not used for matching.
Always read `-ext subjectAltName`, not just `-subject`.

### Hint 2 — Wildcard rules are strict

`*.prd.example` matches `api.prd.example` and not `api.svc.prd.example`
(too many labels) and not `prd.example` (wildcard does not match the apex).
Put every name you need in SAN explicitly when in doubt.

## Solution

Reissue with the right SAN. Do not "fix" it with `curl -k`.

```bash
openssl x509 -in /etc/ssl/svc.crt -noout -ext subjectAltName
# CSR / ACME must include:
#   subjectAltName = DNS:api.prd.example, DNS:api.prd.example
# reload nginx/haproxy after installing the new leaf+chain
```

- **Chain trust ≠ hostname match.** s_client `return code 0` can still be
  the wrong name.
- **SAN wins; CN is decorative** on modern clients.
- **Wildcards are one label only.**
- **Inventory every name** (apex, www, API, gRPC) in the ACME request.
