# The rollout that got stuck halfway

## Briefing

You pushed a new image and the rollout stalled. Some old pods are still up, one new pod is
stuck not-ready, and `kubectl rollout status` hangs. The Deployment is neither fully old
nor fully new.

The new image is broken (or its readiness probe never passes), and the Deployment's
`maxUnavailable`/`maxSurge` settings mean the rollout correctly refuses to proceed —
protecting availability while waiting for a new pod that will never become ready.

## Your Task

- Trigger the rollout to a broken image and observe it stall.
- Explain why the old pods stayed up and the rollout did not fail outright.
- Recover the service: either roll back or fix forward, and understand which to choose.

## Starter Files

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: default
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: nginx:1.27-alpine
          readinessProbe:
            httpGet: { path: /, port: 80 }
            initialDelaySeconds: 2
            periodSeconds: 5
```

### file: break.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
kubectl apply -f app.yaml
kubectl rollout status deploy/api          # healthy baseline

# roll to an image tag that does not exist -> new pod never becomes ready
kubectl set image deploy/api api=nginx:does-not-exist
echo "watch it stall: kubectl get pods -l app=api -w"
```

## Expected Failure

```bash
bash break.sh
kubectl get pods -l app=api
# api-old-1   1/1   Running            0   5m
# api-old-2   1/1   Running            0   5m
# api-old-3   1/1   Running            0   5m
# api-new-x   0/1   ImagePullBackOff   0   1m     <- the surge pod, never ready

kubectl rollout status deploy/api
# Waiting for deployment "api" rollout to finish: 1 out of 3 new replicas... (hangs)
```

With `maxUnavailable: 0`, Kubernetes will not remove a healthy old pod until a new one is
ready. The new one never becomes ready, so the rollout waits indefinitely — the service
stays up on old pods, which is the safe outcome.

## Expected Outcome

The service is healthy on a known-good version, and you understand the two recovery paths.

Roll back to the previous revision:

```bash
kubectl rollout undo deploy/api
kubectl rollout status deploy/api
# deployment "api" successfully rolled out

kubectl get pods -l app=api
# all 3 Running and Ready on the good image
```

Confirm the bad ReplicaSet is scaled to zero:

```bash
kubectl get rs -l app=api
# the broken revision shows DESIRED=0
```

## Hints

### Hint 1 — A stalled rollout is often a feature, not a bug

`maxUnavailable: 0` means "never drop below full capacity". If the new pods cannot become
ready, the rollout *correctly* refuses to retire old pods. Your service is fine; the deploy
is paused. Look at why the new pod is not ready (`describe pod`, `logs`).

### Hint 2 — Undo is instant; fix-forward when you can

`kubectl rollout undo deploy/api` returns to the last good ReplicaSet immediately — the
right move under pressure. If the fix is trivial and known (a typo'd tag), fixing forward
with `kubectl set image` to the correct tag is also fine. Use `rollout history` to see
revisions.

## Solution

The new image tag did not exist, so the surge pod never became ready and the rollout
paused, keeping old pods serving.

Roll back:

```bash
kubectl rollout undo deploy/api
kubectl rollout status deploy/api
```

Or fix forward to the correct tag:

```bash
kubectl set image deploy/api api=nginx:1.27.2-alpine
kubectl rollout status deploy/api
```

Inspect what happened:

```bash
kubectl rollout history deploy/api
kubectl describe pod -l app=api | grep -A3 -i events
```

- **A stalled rollout with old pods still serving is the safe path.** `maxUnavailable: 0`
  trades deploy speed for guaranteed capacity — it will wait forever rather than break the
  service. Read that as working-as-intended, then diagnose the new pod.
- **`rollout undo` is your fastest recovery** — it re-scales the previous ReplicaSet, which
  is still there. Keep several revisions (`revisionHistoryLimit`) so undo has somewhere to
  go.
- **`maxSurge` and `maxUnavailable` shape the behaviour**: surge adds temporary extra pods;
  unavailable permits temporary shortfall. `0/1` means "add one, drop none" — safest, but
  stalls hard on a bad image.
- **Diagnose the new pod, not the Deployment.** The Deployment is doing its job; the pod is
  the problem — `ImagePullBackOff`, a failing readiness probe, a crash. Fix that and the
  rollout resumes on its own.
- **A `progressDeadlineSeconds`** turns an indefinite stall into a reported failure after N
  seconds, which surfaces the problem to CI/CD instead of hanging.
