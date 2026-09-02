# verify=False is still in the healthcheck we copied to production

## Briefing

A year ago someone could not get the corporate proxy's CA into the trust
store (see the Networking proxy lab). They put `ssl._create_unverified_context()`
/ `requests.get(..., verify=False)` in `healthcheck.py` "for an hour".
The file is now the official canary. It will happily 200 against a box
presenting any certificate, including a name that is not the service.

This is the **Python client** side of "do not disable verification". The
fix is to pass a CA bundle, not to keep `verify=False` and ignore the
`InsecureRequestWarning`.

## Your Task

- Show the client succeeding against a self-signed (or wrong-name) server
  because verification is off.
- Turn verification on and watch it fail with a hostname/CA error.
- Point the client at a CA file (or the system store) so it succeeds
  *and* verifies.

## Starter Files

### file: healthcheck.py

```python
#!/usr/bin/env python3
import ssl
import sys
from urllib.request import urlopen

# "temporary" — still here
CTX = ssl._create_unverified_context()


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://127.0.0.1:18443/health"
    with urlopen(url, context=CTX, timeout=5) as resp:
        print("status", resp.status)
        print(resp.read().decode())
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### file: make_cert.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 1 -nodes \
  -subj "/CN=health.internal"
echo "use: python3 -m http.server --bind 127.0.0.1 18443  # will not be TLS"
echo "or:  openssl s_server -accept 18443 -cert cert.pem -key key.pem -www"
```

## Expected Failure

```bash
# with verification disabled, a random self-signed cert still prints:
python3 healthcheck.py
# status 200
# ... whatever the box returned ...
```

The check cannot tell "our service" from "anything that speaks TLS on
that IP".

## Expected Outcome

```bash
# default context — should fail against the self-signed lab cert
python3 healthcheck.py
# ssl.SSLCertVerificationError: certificate verify failed

# with the lab CA/cert pinned:
# ssl.create_default_context(cafile="cert.pem")
python3 healthcheck.py
# status 200
```

No `_create_unverified_context`, no `verify=False`, no
`PYTHONHTTPSVERIFY=0`.

## Hints

### Hint 1 — Default context is the product

`ssl.create_default_context()` uses the system CAs. Pass `cafile=` for a
private CA (the real fix from the proxy incident). Do not wrap it in
`check_hostname = False`.

### Hint 2 — urllib and requests both have an off switch

`requests` : `verify="/path/to/ca.pem"` not `verify=False`.
`CURL_CA_BUNDLE` / `REQUESTS_CA_BUNDLE` / `SSL_CERT_FILE` are the env
knobs if you cannot change the file today — still better than disable.

## Solution

```python
ctx = ssl.create_default_context(cafile="cert.pem")  # or omit cafile for public CAs
with urlopen(url, context=ctx, timeout=5) as resp:
    ...
```

- **`verify=False` is not a health check.** It is a TCP check with extra
  steps.
- **Private CAs belong in `cafile` / the trust store**, not in a comment
  that says temporary.
- **Hostname checks** (`CN`/`SAN`) are part of verification; disabling
  only `check_hostname` is still wrong for a canary.
- **Grep the org for `verify=False` and `_create_unverified_context`.**
  They spread by copy-paste.
