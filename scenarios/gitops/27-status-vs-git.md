# Git is quiet; the app is Progressing forever

## Briefing

`checkout` has not changed in git. Sync Status is `Synced` (or a sync
is stuck `Running`). Health is `Progressing` for 40 minutes. The
application-controller logs `context deadline exceeded`. The app has
too many objects, or one Deployment never becomes Ready, so **status
never converges**.

This is not an OutOfSync loop. Desired git may already match.

## Your Task

- Deploy the timeout-prone Application as given.
- Show `status.health` Progressing while git SHA is unchanged.
- Split the app, raise reconciliation timeout, or fix the workload that
  never is Ready — whichever the evidence says.
- Health must become Healthy (or Degraded with a real reason).

## Starter Files

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: shop
spec:
  replicas: 1
  progressDeadlineSeconds: 600
  selector:
    matchLabels: { app: checkout }
  template:
    metadata:
      labels: { app: checkout }
    spec:
      containers:
        - name: api
          image: nginx:1.27-alpine
          readinessProbe:
            httpGet: { path: /readyz, port: 80 }
            periodSeconds: 5
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: checkout
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
argocd app get checkout
# Sync Status:    Synced to main (abc1234)
# Health Status:  Progressing

kubectl -n argocd logs deploy/argocd-application-controller --tail=50
# context deadline exceeded
# Reconciliation timeout

git rev-parse origin/main
# abc1234   <- unchanged
```

Pods: `Readiness probe failed ... /readyz` 404 while git still asks for
that path — or hundreds of resources, controller timeout before health
is computed.

## Expected Outcome

```bash
argocd app get checkout
# Sync Status:   Synced
# Health Status: Healthy

kubectl -n shop get deploy checkout
# 1/1 Ready
```

If the cause was size: two Applications each reconcile under the
timeout; document `timeout.reconciliation` if you changed it.

## Hints

### Hint 1 — Synced ≠ Healthy ≠ operation done

Synced: live matches git. Healthy: k8s workload health. Progressing:
rollout or health check not finished. A timeout leaves Progressing even
when git is right. Read pods and controller logs before another sync.

### Hint 2 — Timeouts and app size

`timeout.reconciliation` in `argocd-cm` (default 180s) bounds one
reconcile. Giant apps miss the deadline — split by namespace, or
`resource.exclusions`. A broken readiness probe is the small-app
version of the same UI.

## Solution

If the probe path is wrong, fix **git**:

```yaml
readinessProbe:
  httpGet: { path: /, port: 80 }
```

If the controller times out on a huge app, split paths and/or raise
timeout:

```yaml
# argocd-cm
data:
  timeout.reconciliation: 300s
```

```bash
argocd app wait checkout --health
```

- **Spamming `argocd app sync`** on a Progressing wait makes it worse.
  This is not an ignoreDifferences / `:latest` flap: git is still,
  status is not.
