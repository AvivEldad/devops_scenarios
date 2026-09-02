# The container that exits before the probe can pass

## Briefing

A pod restarts every couple of minutes. It is not crashing on startup — it runs for a
while, then Kubernetes kills and restarts it. `RESTARTS` climbs steadily.

A liveness probe is failing against an endpoint the app does not serve, so Kubernetes
concludes the container is unhealthy and restarts it, forever.

## Your Task

- Apply the deployment and watch the restart count climb.
- Determine what is killing the container.
- Fix the probe so it reflects real health and stops the restart loop.

## Starter Files

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
          livenessProbe:
            httpGet:
              path: /healthz      # nginx does not serve this; returns 404
              port: 80
            initialDelaySeconds: 2
            periodSeconds: 5
            failureThreshold: 2
```

## Expected Failure

```bash
kubectl apply -f app.yaml
kubectl get pod -l app=web -w
# web-xxxx   1/1   Running   0   10s
# web-xxxx   1/1   Running   1   45s
# web-xxxx   1/1   Running   2   90s      <- restarting on a timer
```

```bash
kubectl describe pod -l app=web | grep -A3 Liveness
# Liveness probe failed: HTTP probe failed with statuscode: 404
# Killing container ... failed liveness probe, will be restarted
```

The probe requests `/healthz`, which nginx does not serve, so it returns 404. The probe
treats that as failure and Kubernetes restarts the container on schedule.

## Expected Outcome

The pod runs steadily with no restarts.

```bash
kubectl get pod -l app=web
# web-xxxx   1/1   Running   0   5m       <- RESTARTS stays 0
```

The probe targets an endpoint the app actually serves and returns 2xx:

```bash
kubectl exec deploy/web -- wget -qO- -S http://localhost:80/ 2>&1 | grep HTTP
# HTTP/1.1 200 OK
```

Events show no liveness failures over several minutes.

## Hints

### Hint 1 — A liveness probe kills the container when it fails

Liveness answers "is this container still healthy, or should it be restarted?". A probe
against a path that 404s fails, and Kubernetes restarts the container — repeatedly. The app
is fine; the probe is wrong.

### Hint 2 — Probe something the app really serves

Point the probe at a path that returns success (for stock nginx, `/`), or add a real health
endpoint to the app. Tune timing so a slow start is not mistaken for a failure — that is
what `initialDelaySeconds` and, better, `startupProbe` are for.

## Solution

The liveness probe checked an endpoint that did not exist.

```yaml
livenessProbe:
  httpGet:
    path: /            # nginx serves this with 200
    port: 80
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3
```

```bash
kubectl apply -f app.yaml
kubectl get pod -l app=web -w
```

- **A failing liveness probe restarts the container.** If the endpoint is wrong, you get an
  endless restart loop on a healthy app — read the events for `Liveness probe failed` before
  suspecting the code.
- **Probe real health, not an arbitrary path.** For stock images use a path they serve; for
  your own apps add a lightweight health endpoint that checks what actually matters.
- **Liveness vs readiness**: liveness restarts a stuck container; readiness removes a pod
  from Service endpoints without killing it. Using liveness where you meant readiness turns a
  brief unreadiness into a restart loop — a very common mistake.
- **Use a `startupProbe` for slow starters** so liveness does not fire during a legitimately
  long boot; it gives the container a grace window before liveness begins.
