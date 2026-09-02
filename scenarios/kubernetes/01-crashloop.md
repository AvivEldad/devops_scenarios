# CrashLoopBackOff on a pod that works locally

## Briefing

`orders-api` was moved into Kubernetes yesterday. The image is fine — you can run it
with `docker run` and it serves traffic. In the cluster it never becomes ready. The
restart counter climbs every minute and the status alternates between `Error` and
`CrashLoopBackOff`.

The team's instinct is to redeploy it again. Yours should be to ask the pod what
happened.

> Any cluster works: kind, k3d, minikube, Docker Desktop, or a namespace you own on
> a shared cluster. Nothing here needs a registry — the code is delivered by ConfigMap.

## Your Task

Apply the manifest, then get the deployment to a healthy state.

1. Create the namespace and apply the starter manifest.
2. Diagnose why the pod restarts, using only `kubectl`.
3. Fix the manifest so the pod runs, stays running, and serves HTTP.

Do not delete and recreate the namespace to "start clean" — in production you would
not get that option. Edit the manifest and re-apply.

```bash
mkdir -p ~/breakfix/k8s-01 && cd ~/breakfix/k8s-01
kubectl create namespace shop
kubectl apply -f orders.yaml
```

## Starter Files

### file: orders.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-code
  namespace: shop
data:
  app.py: |
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import os

    PORT = int(os.environ.get("PORT", "8080"))

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"orders-api ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            print("request %s" % (fmt % args), flush=True)

    print("orders-api listening on port %d" % PORT, flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: shop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      containers:
        - name: api
          image: python:3.11-alpine
          command: ["python3", "/code/main.py"]
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: code
              mountPath: /code
      volumes:
        - name: code
          configMap:
            name: orders-code
```

## Expected Failure

```bash
kubectl get pods -n shop -w
```

```
NAME                          READY   STATUS             RESTARTS   AGE
orders-api-6d4b8c9f7d-x2mkq   0/1     Error              1          8s
orders-api-6d4b8c9f7d-x2mkq   0/1     CrashLoopBackOff   1          20s
```

The `RESTARTS` column keeps climbing. `CrashLoopBackOff` is not itself an error —
it is Kubernetes telling you it is deliberately waiting longer between restart
attempts (10s, 20s, 40s, up to 5 minutes) because the container keeps dying.

The status alone never tells you *why*. The pod does.

## Expected Outcome

The pod is running, ready, and has stopped restarting:

```bash
kubectl get pods -n shop
# NAME                          READY   STATUS    RESTARTS   AGE
# orders-api-xxxxxxxxx-xxxxx    1/1     Running   0          2m
```

Let it sit for two minutes and confirm `RESTARTS` stays at `0`. A pod that restarts
slowly is still broken.

The application logged its startup line:

```bash
kubectl logs -n shop deploy/orders-api
# orders-api listening on port 8080
```

It serves traffic:

```bash
kubectl port-forward -n shop deploy/orders-api 8080:8080 &
curl -s http://localhost:8080
# orders-api ok
kill %1
```

And the deployment reports itself complete:

```bash
kubectl rollout status deploy/orders-api -n shop
# deployment "orders-api" successfully rolled out
```

## Hints

### Hint 1 — Read the container's last words

Three commands answer almost every CrashLoop, in this order:

```bash
kubectl logs -n shop <pod>            # what the process printed this time
kubectl logs -n shop <pod> --previous # what it printed before the last restart
kubectl describe pod -n shop <pod>    # why the kubelet thinks it died
```

`--previous` matters: once the container restarts, `kubectl logs` shows the new
attempt, which may still be starting. In `describe`, look at `Last State`,
`Reason`, and `Exit Code` under the container, then at the `Events` at the bottom.

### Hint 2 — Exit code 2 from Python means it never ran your code

The log says something like:

```
python3: can't open file '/code/main.py': [Errno 2] No such file or directory
```

The container started, Python started, and then could not find the file it was told
to execute. So the question is not "why did the app crash" — the app never ran. What
is actually inside `/code`?

### Hint 3 — A ConfigMap volume creates one file per key

Check what the ConfigMap actually provides:

```bash
kubectl get configmap orders-code -n shop -o jsonpath='{.data}' | head -c 200
```

The key name in `data:` becomes the filename inside the mount. Compare that filename
against the path in `command:`. One of the two has to change — and changing the
ConfigMap key means changing anything else that references it, so prefer the smaller
blast radius.

### Hint 4 — Add a readiness probe once it runs

Getting it to `Running` is only half of "healthy". Without a readiness probe,
Kubernetes sends traffic to the pod the moment the process starts, before it can
serve. The application already answers `GET /`.

## Solution

The container never crashed in the interesting sense — it failed to start, because
`command:` points at `/code/main.py` while the ConfigMap key is `app.py`, so the
mounted file is `/code/app.py`.

```bash
kubectl describe pod -n shop -l app=orders-api | grep -A5 "Last State"
# Last State:  Terminated
#   Reason:    Error
#   Exit Code: 2
```

Fix the command path and add a readiness probe:

```yaml
      containers:
        - name: api
          image: python:3.11-alpine
          command: ["python3", "/code/app.py"]
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 2
            periodSeconds: 5
          volumeMounts:
            - name: code
              mountPath: /code
```

Apply and watch:

```bash
kubectl apply -f orders.yaml
kubectl rollout status deploy/orders-api -n shop
```

Two things worth knowing for next time:

- **`command` overrides the image's `ENTRYPOINT`, and `args` overrides `CMD`.** The
  Kubernetes field names do not match the Docker terms, which is a reliable source
  of confusion. If you set `command` in a manifest, the image's own start command is
  ignored entirely.
- **Editing a ConfigMap does not restart pods.** The mounted file updates on its own
  schedule (up to a minute or so) and a process that read the file at startup never
  notices. After changing config, run
  `kubectl rollout restart deploy/orders-api -n shop`.

## What You Learned

`CrashLoopBackOff` is a symptom with dozens of causes: a missing file, a missing
environment variable, an OOM kill, a failing liveness probe, a bad image entrypoint.
The status never distinguishes them, so a fixed diagnostic sequence beats intuition.

Learn this loop and use it every single time, before forming any theory:
`kubectl get pods` to see state and restart count, `kubectl logs --previous` to read
the dying process's own output, then `kubectl describe pod` for the kubelet's view
including exit code and events.
