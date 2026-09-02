# The service that routes to nothing

## Briefing

A Service exists, has a stable ClusterIP, and answers on port 80 — but every request times
out or is refused. The pods behind it are `Running` and healthy.

The Service's selector does not match the pods' labels, so the Service has no endpoints.
A Service with no endpoints is a black hole: it accepts the connection attempt and routes
it nowhere.

## Your Task

- Apply the pods and Service and confirm requests to the Service fail.
- Determine why the Service has no backends.
- Fix the routing so the Service reaches the pods.

## Starter Files

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }        # pods are labelled app=web
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: default
spec:
  selector:
    app: frontend                 # selects app=frontend - no such pods
  ports:
    - port: 80
      targetPort: 80
```

## Expected Failure

```bash
kubectl apply -f app.yaml
kubectl run tmp --rm -it --image=busybox:1.36 --restart=Never -- \
  wget -qO- --timeout=3 http://web
# wget: download timed out
```

```bash
kubectl get endpoints web
# NAME   ENDPOINTS   AGE
# web    <none>      30s
```

`ENDPOINTS <none>` is the tell: the Service selector `app=frontend` matches no pods (they
are `app=web`), so there are no backends and traffic goes nowhere.

## Expected Outcome

The Service has endpoints and serves traffic.

Endpoints are populated with the pod IPs:

```bash
kubectl get endpoints web
# web   10.x.x.x:80,10.x.x.x:80   1m
```

Requests succeed:

```bash
kubectl run tmp --rm -it --image=busybox:1.36 --restart=Never -- \
  wget -qO- http://web | head -1
# <!DOCTYPE html>  (nginx welcome page)
```

The Service selector matches the pod labels:

```bash
kubectl get svc web -o jsonpath='{.spec.selector}{"\n"}'
# {"app":"web"}
```

## Hints

### Hint 1 — Check the endpoints first

For any "Service does not work" problem, the first command is:

```bash
kubectl get endpoints <svc>
```

`<none>` means the selector matches no ready pods — a labelling problem, not a network
problem. Addresses listed means the Service has backends and you should look at ports,
readiness, or network policy instead.

### Hint 2 — Selector must match pod labels, and ports must line up

The Service `selector` must equal the pods' labels. Also confirm `targetPort` matches the
container's port and that pods are *ready* — only ready pods appear as endpoints, so a
failing readiness probe also empties the list.

## Solution

The Service selected `app=frontend`; the pods were `app=web`.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: default
spec:
  selector:
    app: web            # matches the pods
  ports:
    - port: 80
      targetPort: 80
```

```bash
kubectl apply -f app.yaml
kubectl get endpoints web        # now lists pod IPs
```

- **`kubectl get endpoints` is the diagnostic.** `<none>` = selector matches no ready pods;
  addresses present = the Service has backends and the problem is elsewhere (ports, policy,
  app).
- **Service selector must equal pod labels.** This is the single most common Service bug —
  the Service and Deployment drift apart in labels and the Service silently serves nothing.
- **Only ready pods become endpoints.** A failing readiness probe removes pods from the
  Service without any selector problem, producing the same "no endpoints" symptom — check pod
  readiness too.
- **`port` vs `targetPort`**: `port` is what the Service exposes; `targetPort` must match the
  container's listening port. A mismatch gives connection-refused even with correct
  endpoints.
- **`kubectl describe svc`** summarises selector, ports and endpoints together — a fast
  one-command overview when triaging.
