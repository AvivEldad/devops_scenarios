# Rollout stuck at 1/3 and the old pods are gone

## Briefing

A colleague pushed a "small config change" to `payments` twenty minutes ago and went
to lunch. The rollout never completed. Worse, capacity is now *below* where it
started: the old pods were torn down and the new ones never came up.

`kubectl rollout status` has been hanging in someone's terminal the whole time.
There are three distinct mistakes in this manifest, and they mask each other — you
will fix one, see no improvement, and have to keep going.

> You need a cluster where you can see nodes. A single-node kind or minikube cluster
> is ideal, because one of the faults is about scheduling.

## Your Task

1. Apply the manifest and observe the stuck rollout.
2. Find all three faults and fix them.
3. Get to three ready pods, and make the deployment strategy safe so that a future
   bad rollout cannot take capacity to zero again.

```bash
mkdir -p ~/breakfix/k8s-03 && cd ~/breakfix/k8s-03
kubectl create namespace payments
kubectl apply -f payments.yaml
```

## Starter Files

### file: payments.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: payments-code
  namespace: payments
data:
  app.py: |
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import os

    PORT = int(os.environ.get("PORT", "8080"))

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/healthz":
                body = b"ok\n"
            else:
                body = b"payments ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            print("request %s" % (fmt % args), flush=True)

    print("payments listening on port %d" % PORT, flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments
  namespace: payments
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 3
      maxSurge: 0
  selector:
    matchLabels:
      app: payments
  template:
    metadata:
      labels:
        app: payments
    spec:
      containers:
        - name: api
          image: python:3.11-alpine
          command: ["python3", "/code/app.py"]
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 3
            periodSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              cpu: "4"
              memory: "16Gi"
            limits:
              cpu: "4"
              memory: "16Gi"
          volumeMounts:
            - name: code
              mountPath: /code
      volumes:
        - name: code
          configMap:
            name: payments-code
```

## Expected Failure

```bash
kubectl rollout status deploy/payments -n payments
# Waiting for deployment "payments" rollout to finish: 0 of 3 updated replicas are available...
```

It never returns. The pods tell a different story depending on your cluster size:

```bash
kubectl get pods -n payments
# NAME                        READY   STATUS    RESTARTS   AGE
# payments-5f8d9c6b7-aaaaa    0/1     Pending   0          3m
# payments-5f8d9c6b7-bbbbb    0/1     Pending   0          3m
# payments-5f8d9c6b7-ccccc    0/1     Pending   0          3m
```

`Pending` with no node assigned is a scheduling failure, and it looks nothing like a
crash: there are no logs to read, because no container was ever created.

## Expected Outcome

Three pods ready, rollout complete, and a strategy that protects capacity.

```bash
kubectl rollout status deploy/payments -n payments
# deployment "payments" successfully rolled out

kubectl get deploy payments -n payments
# NAME       READY   UP-TO-DATE   AVAILABLE   AGE
# payments   3/3     3            3           5m
```

All three pods are scheduled onto nodes and ready:

```bash
kubectl get pods -n payments -o wide
# every pod: 1/1 Running, with a real NODE value, RESTARTS 0
```

The readiness probe is actually passing rather than being absent:

```bash
kubectl describe pod -n payments -l app=payments | grep -i readiness
# Readiness:  http-get http://:http/healthz delay=3s timeout=1s period=5s #success=1 #failure=3
```

The Service has all three backends:

```bash
kubectl get endpoints -n payments payments
# three IPs, or run the deployment without a Service and check endpointslices
```

And a future rollout cannot delete every pod at once:

```bash
kubectl get deploy payments -n payments \
  -o jsonpath='{.spec.strategy.rollingUpdate}'
# maxUnavailable must be 0 or 1, not 3
```

Prove the last point by rolling again and watching that availability never hits zero:

```bash
kubectl rollout restart deploy/payments -n payments
kubectl get pods -n payments -w
# at least 2 pods stay Running throughout
```

## Hints

### Hint 1 — Pending means the scheduler, not the application

There are no logs for a `Pending` pod because no container started. The scheduler
writes its reasoning into the pod's events:

```bash
kubectl describe pod -n payments -l app=payments | tail -20
```

Look for a `FailedScheduling` event. It will say something like
`0/1 nodes are available: 1 Insufficient cpu, 1 Insufficient memory`.

### Hint 2 — Compare requests against what your nodes actually have

```bash
kubectl get nodes -o custom-columns='NAME:.metadata.name,CPU:.status.allocatable.cpu,MEM:.status.allocatable.memory'
kubectl get deploy payments -n payments -o jsonpath='{.spec.template.spec.containers[0].resources}'
```

`requests` is what the scheduler must reserve on a node before it will place the
pod. It is not a cap and not a guess about usage — it is a hard reservation. Asking
for 4 CPUs and 16 GiB for a stdlib HTTP server means no node can ever fit it.

Set requests to something the workload plausibly uses. A tiny Python server is
comfortable in `50m` CPU and `64Mi` memory.

### Hint 3 — Now they schedule, and still nothing is ready

After the resource fix, the pods reach `Running` but stay `0/1`. `Running` means the
container process started; `0/1` means the readiness probe is failing.

```bash
kubectl describe pod -n payments -l app=payments | grep -A3 Warning
# Readiness probe failed: HTTP probe failed with statuscode: 404
```

Read the probe path in the manifest, then read which paths the application actually
serves in the ConfigMap. A 404 from a probe is a configuration mistake, not an
application failure.

### Hint 4 — Why capacity went to zero

`maxUnavailable: 3` with `replicas: 3` authorises Kubernetes to terminate every
existing pod before a single replacement is ready, and `maxSurge: 0` forbids it from
creating extra pods to compensate. The rollout was therefore guaranteed to cause an
outage the moment the new pods were unhealthy for any reason.

Think about which combination keeps the service up during a bad deploy, given that
you cannot know in advance that a deploy is bad.

## Solution

Three faults, layered so each one hides the next.

**Fault 1 — impossible resource requests.** `cpu: "4"` and `memory: "16Gi"` exceed
what any typical node can allocate, so the scheduler leaves the pods `Pending`
forever with a `FailedScheduling` event.

**Fault 2 — readiness probe on a path that does not exist.** The probe requests
`/health`; the application serves `/healthz`. The probe gets a 404, the pod never
becomes ready, and the rollout never progresses.

**Fault 3 — a strategy that permits total outage.** `maxUnavailable: 3` with
`maxSurge: 0` allowed all three old pods to be removed before any new pod was ready.

The corrected Deployment spec:

```yaml
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: payments
  template:
    metadata:
      labels:
        app: payments
    spec:
      containers:
        - name: api
          image: python:3.11-alpine
          command: ["python3", "/code/app.py"]
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 3
            periodSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          volumeMounts:
            - name: code
              mountPath: /code
      volumes:
        - name: code
          configMap:
            name: payments-code
```

```bash
kubectl apply -f payments.yaml
kubectl rollout status deploy/payments -n payments
```

The reasoning behind each corrected value:

- **`maxUnavailable: 0, maxSurge: 1`** means Kubernetes must bring up a new ready pod
  *before* removing an old one. The rollout is slower and cannot reduce capacity
  below `replicas`. This is the right default for anything serving traffic. It
  requires headroom for one extra pod, which is exactly what the resource fix
  bought you.
- **Requests low, limits higher.** Requests are the scheduling reservation; limits
  are the enforcement ceiling. Setting requests equal to a large limit wastes an
  entire node's capacity per pod. Note that exceeding a *memory* limit gets the
  container OOM-killed, while exceeding a *CPU* limit only throttles it.
- **`targetPort`-style named ports in the probe** (`port: http`) keep the probe
  aligned with the container port automatically.
- **Liveness versus readiness.** This scenario deliberately uses only a readiness
  probe. A liveness probe on the same wrong path would have *restarted* the
  container repeatedly, turning a stalled rollout into a CrashLoop and making
  diagnosis harder. Add liveness only when you know what "unrecoverably wedged"
  means for your app, and never point it at a dependency you do not control.

For real production you would also add a `PodDisruptionBudget` so that node drains
and cluster upgrades cannot do what this rollout did:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payments
  namespace: payments
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: payments
```

## What You Learned

The three faults form a diagnostic ladder, and you cannot see rung two until you
have climbed rung one. That is the normal shape of a real incident: you fix
something real, the symptom persists, and the temptation is to revert your correct
fix and go looking elsewhere. Resist it — verify that the *failure mode changed*,
even when the outcome has not.

The status vocabulary is what makes this fast. `Pending` is the scheduler and you
read events. `Running` but `0/1` is readiness and you read the probe. `CrashLoopBackOff`
is the process and you read logs. Three states, three different first commands.
