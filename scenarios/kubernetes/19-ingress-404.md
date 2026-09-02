# The ingress that returns 404 for a route that exists

## Briefing

An Ingress is defined, the backing Service works when you port-forward to it, but hitting
the Ingress host returns `404 Not Found` from the ingress controller — or a `503` /
`default backend`.

The Ingress rule is subtly wrong: missing or mismatched `ingressClassName`, a host that
does not resolve to the controller, a wrong `pathType`, or a Service port name/number that
does not exist. The controller cannot map the request to your Service.

## Your Task

- Apply the Service and Ingress and reproduce the 404 from the ingress host.
- Determine why the controller does not route to your Service.
- Fix the Ingress so the route resolves to the app.

## Starter Files

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: site
  namespace: default
spec:
  replicas: 1
  selector: { matchLabels: { app: site } }
  template:
    metadata: { labels: { app: site } }
    spec:
      containers:
        - name: site
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata:
  name: site
  namespace: default
spec:
  selector: { app: site }
  ports:
    - name: http
      port: 8080
      targetPort: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: site
  namespace: default
  # no ingressClassName -> controller may ignore this Ingress entirely
spec:
  rules:
    - host: site.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: site
                port:
                  number: 80        # Service exposes 8080, not 80 -> mismatch
```

## Expected Failure

```bash
kubectl apply -f app.yaml
curl -H 'Host: site.local' http://<ingress-controller-ip>/
# 404 Not Found  (or the controller's default backend)
```

```bash
kubectl describe ingress site | sed -n '/Rules/,/Events/p'
# the backend references port 80, but the Service 'site' only has port 8080
# and no ingressClassName is set, so a class-scoped controller may skip it
```

Two problems: the Ingress backend points at port `80`, but the Service exposes `8080`; and
without `ingressClassName`, a controller configured to only handle its class ignores the
Ingress, sending everything to the default backend (404).

## Expected Outcome

The route resolves to the app.

The Ingress has a class and a correct backend port:

```bash
kubectl get ingress site -o jsonpath='{.spec.ingressClassName}{"\n"}'
# nginx   (or whatever `kubectl get ingressclass` shows)
```

The request returns the app, not the default backend:

```bash
curl -H 'Host: site.local' http://<ingress-controller-ip>/ | head -1
# <!DOCTYPE html>   (nginx welcome page from the 'site' pod)
```

The Ingress shows a real backend and address:

```bash
kubectl get ingress site
# NAME   CLASS   HOSTS        ADDRESS       PORTS   AGE
# site   nginx   site.local   <lb-ip>       80      2m
```

## Hints

### Hint 1 — Class, host, path, port: check all four

- `ingressClassName` must match an installed IngressClass (`kubectl get ingressclass`).
  Missing class means the controller may ignore the Ingress entirely.
- The `Host` header must match the rule's `host`, and the host must resolve to the
  controller (use `curl -H 'Host: ...'` to test without DNS).
- `backend.service.port` must match a port the Service actually exposes (name or number).

### Hint 2 — Verify the chain inward

Test from the inside out: does the Service have endpoints
(`kubectl get endpoints site`)? Does `port-forward svc/site 8080:8080` serve the app? If the
Service is fine but the Ingress 404s, the problem is in the Ingress mapping (class/host/
path/port), not the app.

## Solution

Set the ingress class and point the backend at the Service's real port.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: site
  namespace: default
spec:
  ingressClassName: nginx          # must match `kubectl get ingressclass`
  rules:
    - host: site.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: site
                port:
                  number: 8080     # matches the Service's exposed port
```

```bash
kubectl apply -f app.yaml
curl -H 'Host: site.local' http://<ingress-controller-ip>/ | head -1
```

- **404 from the ingress controller means "no rule matched"**, not "app is down". The app
  can be perfectly healthy while the Ingress fails to map the request — separate the two by
  port-forwarding to the Service.
- **`ingressClassName` is mandatory in practice.** A controller scoped to its class ignores
  Ingresses without it, silently routing to the default backend. Check
  `kubectl get ingressclass`.
- **Backend port must match the Service.** Reference the Service's exposed `port` (by number
  or name), not the container's port. `8080` vs `80` here is the classic mismatch.
- **Test hosts with `curl -H 'Host: ...'`** so you do not need DNS to exist yet; the
  controller routes on the Host header. `pathType: Prefix` vs `Exact` also changes matching.
- **Work inside-out**: endpoints → Service (port-forward) → Ingress. Fixing the layer that
  actually fails saves you from tweaking the wrong one.
