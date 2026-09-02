# Service returns connection refused, pods are Running

## Briefing

The `checkout` deployment is green. Three pods, all `1/1 Running`, zero restarts,
logs clean. The Service object exists and has a ClusterIP.

The frontend team says every call to `http://checkout.shop.svc.cluster.local` times
out, and they have opened a ticket claiming "the checkout pods are down". They are
not down. Something between the Service and the pods is wrong, and no pod-level
command will show it to you.

> Works on any cluster where you can create a namespace.

## Your Task

1. Apply the manifest.
2. Make requests to the Service reach the pods.

Diagnose before you change anything. There are **two** faults, and after you fix the
first the symptom barely changes — which is exactly why this one is worth doing
slowly.

```bash
mkdir -p ~/breakfix/k8s-02 && cd ~/breakfix/k8s-02
kubectl create namespace shop
kubectl apply -f checkout.yaml
```

## Starter Files

### file: checkout.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-code
  namespace: shop
data:
  app.py: |
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import os

    PORT = int(os.environ.get("PORT", "5000"))

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"checkout ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            print("request %s" % (fmt % args), flush=True)

    print("checkout listening on port %d" % PORT, flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: shop
spec:
  replicas: 3
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
        tier: backend
    spec:
      containers:
        - name: api
          image: python:3.11-alpine
          command: ["python3", "/code/app.py"]
          env:
            - name: PORT
              value: "5000"
          ports:
            - containerPort: 5000
          volumeMounts:
            - name: code
              mountPath: /code
      volumes:
        - name: code
          configMap:
            name: checkout-code
---
apiVersion: v1
kind: Service
metadata:
  name: checkout
  namespace: shop
spec:
  type: ClusterIP
  selector:
    app: checkout-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

## Expected Failure

Everything reports healthy:

```bash
kubectl get pods -n shop
# NAME                        READY   STATUS    RESTARTS   AGE
# checkout-7c9f8d5b4-abcde    1/1     Running   0          1m
# checkout-7c9f8d5b4-fghij    1/1     Running   0          1m
# checkout-7c9f8d5b4-klmno    1/1     Running   0          1m

kubectl get svc -n shop checkout
# NAME       TYPE        CLUSTER-IP     PORT(S)   AGE
# checkout   ClusterIP   10.96.140.22   80/TCP    1m
```

But traffic goes nowhere:

```bash
kubectl run probe -n shop --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sS --max-time 5 http://checkout
# curl: (28) Connection timed out
```

Note the failure mode. A timeout, not a refusal — the Service has an IP, so the
connection is accepted by the cluster network and then has nowhere to go.

## Expected Outcome

The Service must have real backends and answer requests.

Endpoints are populated with three pod IPs on the correct port:

```bash
kubectl get endpointslice -n shop -l kubernetes.io/service-name=checkout \
  -o custom-columns='ADDRESSES:.endpoints[*].addresses,PORTS:.ports[*].port'
# three addresses, port 5000
```

The Service answers from inside the cluster:

```bash
kubectl run probe -n shop --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sS http://checkout
# checkout ok
```

The DNS name works too, since that is what the frontend actually calls:

```bash
kubectl run probe -n shop --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sS http://checkout.shop.svc.cluster.local
# checkout ok
```

And the pods logged the requests, proving traffic reached the application rather
than being answered by something else:

```bash
kubectl logs -n shop -l app=checkout --tail=5 | grep request
# request "GET / HTTP/1.1" 200 -
```

## Hints

### Hint 1 — Ask the Service who its backends are

A Service does not route to pods directly. It selects pods by label, and the
endpoints controller writes the matching pod IPs into an EndpointSlice. If that list
is empty, the Service is a black hole.

```bash
kubectl get endpoints -n shop checkout
```

If you see `<none>` in the ENDPOINTS column, no pod matched the selector. That is a
label problem, never a pod problem.

### Hint 2 — Compare the two label sets character by character

```bash
kubectl get svc checkout -n shop -o jsonpath='{.spec.selector}'
kubectl get pods -n shop --show-labels
```

The Service selects `app=checkout-api`. What labels do the pods actually carry?
A selector matches pod labels, not the Deployment's name — and there is no
validation that warns you when a selector matches nothing.

### Hint 3 — Fixing the selector is not enough

Once endpoints appear, try the curl again. Still failing, but differently now:
connection refused rather than timing out, because traffic finally reaches a pod
and finds nothing listening on the port it was sent to.

`port` is what the Service listens on. `targetPort` is the port on the pod that
traffic is forwarded to. Which port does this container actually listen on?

### Hint 4 — Name your ports so this cannot recur

You can give the container port a name and have `targetPort` refer to that name
instead of a number. Then the two can never drift apart:

```yaml
# in the container spec
ports:
  - name: http
    containerPort: 5000
# in the Service
targetPort: http
```

## Solution

Two faults, both invisible from the pods' point of view.

**Fault 1: the selector matches nothing.** The Service selects `app=checkout-api`;
the pods are labelled `app=checkout`. The endpoints list is empty, so the ClusterIP
accepts connections and drops them.

**Fault 2: the target port is wrong.** `targetPort: 8080` while the container
listens on `5000`.

Corrected Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: checkout
  namespace: shop
spec:
  type: ClusterIP
  selector:
    app: checkout
  ports:
    - name: http
      port: 80
      targetPort: http
```

And name the container port so `targetPort: http` resolves:

```yaml
          ports:
            - name: http
              containerPort: 5000
```

Apply and verify:

```bash
kubectl apply -f checkout.yaml
kubectl get endpoints -n shop checkout
```

The mental model that makes this quick to diagnose:

```
client -> Service ClusterIP:port -> EndpointSlice (pods matching selector) -> podIP:targetPort
```

Every Service problem is a break in one of those arrows, and `kubectl get endpoints`
tells you instantly whether the break is before or after the selector. Empty
endpoints means labels; populated endpoints with failing traffic means ports,
readiness, or the application.

One more trap for the future: a pod that is `Running` but **not ready** is also
removed from endpoints. So an empty endpoint list can mean either a selector
mismatch or a failing readiness probe, and `kubectl get pods` distinguishes them by
the `READY` column.

## What You Learned

The pods being healthy told you nothing, because the fault was in an object that
does not appear in `kubectl get pods` at all. When a ticket says "the pods are down"
and the pods are up, the next question is always what sits between the caller and
the pod.

`kubectl get endpoints` is the single highest-value command for Service problems,
and almost nobody reaches for it first. Make it your reflex.
