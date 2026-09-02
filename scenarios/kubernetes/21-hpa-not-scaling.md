# The HPA that will not scale

## Briefing

A HorizontalPodAutoscaler is configured to scale on CPU, load is high, but replicas stay
at the minimum. `kubectl get hpa` shows `<unknown>` for the current metric, or `TARGET`
never moves.

The HPA cannot read CPU because metrics-server is missing or the pods have no CPU
`requests` — an HPA percentage target is a percentage *of requests*, so with no request
there is nothing to compute against. It never gets the signal to scale.

## Your Task

- Deploy an app under load with an HPA and observe it not scaling.
- Determine why the HPA shows `<unknown>` or refuses to scale.
- Fix it so the HPA reads utilisation and scales up under load.

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
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          # NO resources.requests.cpu -> percentage-based HPA has no base to compute
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
  namespace: default
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50      # 50% of WHAT? there is no request
```

## Expected Failure

```bash
kubectl apply -f app.yaml
kubectl get hpa web
# NAME   REFERENCE        TARGETS         MINPODS   MAXPODS   REPLICAS
# web    Deployment/web   <unknown>/50%   1         5         1

kubectl describe hpa web | grep -i -A2 'unable\|failed\|metrics'
# failed to get cpu utilization: missing request for cpu
# (or) unable to fetch metrics from resource metrics API
```

Two possible causes, both giving `<unknown>`: the container has no CPU *request*, so a
utilisation percentage is undefined; and/or metrics-server is not installed, so the HPA has
no metrics source at all.

## Expected Outcome

The HPA reads utilisation and scales under load.

metrics-server is available and the HPA shows a real number:

```bash
kubectl get hpa web
# web   Deployment/web   180%/50%   1   5   4      <- reading metrics, scaling up
```

The Deployment scales out under load and back in when idle:

```bash
kubectl get deploy web
# web   4/4   ...     (then returns toward minReplicas when load drops)
```

The container declares a CPU request the percentage is computed against:

```bash
kubectl get deploy web -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}{"\n"}'
# 100m
```

## Hints

### Hint 1 — Utilisation HPA needs CPU requests

`averageUtilization: 50` means "50% of the CPU *request*". With no `requests.cpu`, that ratio
is undefined and the HPA reports `<unknown>` and never scales. Add a realistic
`requests.cpu`. (An `averageValue` target avoids needing a request, but utilisation is the
common case.)

### Hint 2 — The HPA needs a metrics source

`<unknown>` also appears when metrics-server (or another metrics API provider) is not
installed. Check `kubectl top pods` works; if it errors, install metrics-server. For custom/
external metrics you need the corresponding adapter. `kubectl describe hpa` states exactly
which it could not fetch.

## Solution

Add a CPU request so utilisation is defined, and ensure metrics-server is present.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 1
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: "100m", memory: "64Mi" }   # base for utilisation %
            limits:   { memory: "128Mi" }
```

```bash
# ensure metrics are available
kubectl top pods          # must return numbers, not an error

kubectl apply -f app.yaml
# generate load, then:
kubectl get hpa web -w    # TARGETS shows real %, REPLICAS climbs
```

- **Utilisation-based HPA is a percentage of the CPU *request*.** No request means no base,
  so the HPA reports `<unknown>` and never acts. This is the most common "HPA won't scale"
  cause after metrics-server.
- **The HPA needs a working metrics API.** `kubectl top pods` is the quick test — if it
  errors, install metrics-server (or the right adapter for custom/external metrics). `describe
  hpa` names the exact metric it failed to fetch.
- **Use `autoscaling/v2`** for multiple metrics, `averageValue` vs `Utilization` targets, and
  scaling behaviour. `averageValue` lets you scale without a request when a percentage does
  not fit.
- **Scaling has stabilisation windows.** Scale-up is quick; scale-down is deliberately
  delayed (default 5 min) to avoid flapping — do not mistake a slow scale-down for a broken
  HPA. Tune via `behavior`.
- **HPA and manual `kubectl scale`/GitOps `replicas` fight.** If something else also manages
  `replicas`, they oscillate. Let the HPA own `replicas` and remove it from the managed
  manifest.
