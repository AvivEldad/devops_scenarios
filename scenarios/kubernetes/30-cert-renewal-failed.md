# The certificate that expired and no one noticed

## Briefing

An internal service suddenly fails with TLS errors — clients report an expired or untrusted
certificate. The certificate was issued by cert-manager months ago and should have renewed
automatically. It did not.

The `Certificate` is stuck: the `Issuer`/`ClusterIssuer` is not ready, an ACME challenge
cannot be solved, or the renewal never triggered because the resource is in a failed state.
The app kept serving the old cert until it expired, so nothing alarmed until the deadline
passed.

## Your Task

- Inspect a cert-manager `Certificate` that failed to renew and confirm the expiry.
- Trace the failure through Certificate → CertificateRequest → Order/Challenge → Issuer.
- Get a valid certificate issued and understand how to catch this before expiry next time.

## Starter Files

### file: cert.yaml

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: web-tls
  namespace: default
spec:
  secretName: web-tls
  duration: 2160h        # 90d
  renewBefore: 360h      # renew 15d before expiry
  dnsNames:
    - web.example.com
  issuerRef:
    name: letsencrypt     # references an Issuer that is NOT Ready
    kind: ClusterIssuer
    group: cert-manager.io
```

### file: notes.md

```text
Symptoms:
  curl https://web.example.com
    curl: (60) SSL certificate problem: certificate has expired

  kubectl get certificate web-tls
    NAME      READY   SECRET    AGE
    web-tls   False   web-tls   120d

The Secret 'web-tls' still holds the OLD, now-expired certificate.
Renewal should have happened at day 75 (renewBefore 15d) but did not.
```

## Expected Failure

```bash
kubectl get certificate web-tls
# NAME      READY   SECRET    AGE
# web-tls   False   web-tls   120d

kubectl describe certificate web-tls | tail -5
# Not ready: issuance failed; see CertificateRequest

kubectl get clusterissuer letsencrypt
# NAME          READY
# letsencrypt   False        <- the issuer itself is broken
```

```bash
# the served cert is expired:
echo | openssl s_client -connect web.example.com:443 2>/dev/null \
  | openssl x509 -noout -enddate
# notAfter=<a date in the past>
```

The Certificate is `READY: False` because the ClusterIssuer is not ready (bad ACME config,
solver problem, or credentials), so renewal never completed. The old Secret kept serving
until it expired — a silent failure that only surfaced at the deadline.

## Expected Outcome

A valid certificate is issued and the chain to the issuer is healthy.

The issuer and certificate are Ready:

```bash
kubectl get clusterissuer letsencrypt      # READY True
kubectl get certificate web-tls            # READY True
```

The Secret holds a fresh cert with a future expiry:

```bash
kubectl get secret web-tls -o jsonpath='{.data.tls\.crt}' | base64 -d \
  | openssl x509 -noout -enddate
# notAfter=<a date ~90 days out>
```

The service serves the new cert:

```bash
echo | openssl s_client -connect web.example.com:443 2>/dev/null \
  | openssl x509 -noout -enddate
# a future date
```

## Hints

### Hint 1 — Follow the chain of resources

cert-manager issuance is a chain. Walk it in order:

```bash
kubectl describe certificate web-tls
kubectl get certificaterequest             # the active request
kubectl describe certificaterequest <name>
kubectl get order,challenge -A            # for ACME issuers
kubectl describe clusterissuer letsencrypt
```

The failure is almost always at one link: issuer not Ready, an ACME `Challenge` stuck
(HTTP-01 ingress not reachable, DNS-01 record not propagated), or missing credentials.

### Hint 2 — Fix the issuer, then force renewal

Repair the root cause (issuer config, solver, credentials), confirm the ClusterIssuer is
`READY: True`, then trigger a fresh issuance:

```bash
# cert-manager supports forcing renewal:
kubectl cert-manager renew web-tls        # if the plugin is installed
# or delete the CertificateRequest / annotate to re-issue
```

## Solution

Diagnose down the chain, fix the issuer, and force a renewal so a valid cert is written to
the Secret.

```bash
# 1) find the failing link
kubectl describe certificate web-tls
kubectl describe clusterissuer letsencrypt        # usually the culprit
kubectl get challenge -A                           # ACME challenges stuck?

# 2) fix the issuer (example causes):
#    - ACME email/server wrong, or private key secret missing
#    - HTTP-01 solver: ingress class/route not reachable from the ACME server
#    - DNS-01 solver: cloud credentials or zone wrong
#    correct the ClusterIssuer spec and re-apply, then:
kubectl get clusterissuer letsencrypt              # wait for READY True

# 3) force a fresh issuance
kubectl cert-manager renew web-tls -n default      # or delete the stuck CertificateRequest

# 4) verify
kubectl get certificate web-tls                    # READY True
kubectl get secret web-tls -o jsonpath='{.data.tls\.crt}' | base64 -d \
  | openssl x509 -noout -enddate
```

- **A failed renewal is silent until expiry.** The old Secret keeps serving, so nothing
  breaks until the certificate actually expires — which is why monitoring cert expiry (not
  just "is the pod up") is essential.
- **Issuance is a chain**: Certificate → CertificateRequest → (ACME) Order → Challenge →
  Issuer. `READY: False` on the Certificate just says "look downstream"; walk the chain with
  `describe` until you find the link that failed.
- **The issuer is the usual root cause.** A `ClusterIssuer`/`Issuer` that is not Ready — bad
  ACME config, unreachable HTTP-01 solver, unpropagated DNS-01 record, missing credentials —
  blocks every certificate that references it.
- **Force renewal after fixing** (`kubectl cert-manager renew`, or delete the stuck
  CertificateRequest) rather than waiting for the next automatic attempt.
- **Alert on expiry proactively.** Export certificate expiry (cert-manager metrics, or a
  blackbox probe of the TLS endpoint) and alert well before `renewBefore`, so a stuck renewal
  is caught with days to spare — not at the outage.
- **`renewBefore` gives you the window.** With `renewBefore: 15d`, a renewal that starts
  failing still leaves ~15 days to notice and fix — but only if something is watching.
