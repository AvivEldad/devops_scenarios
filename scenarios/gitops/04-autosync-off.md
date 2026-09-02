# The merge that never reached the cluster

## Briefing

The image tag merge landed on `main` ninety minutes ago. Git shows
`nginx:1.27.2-alpine`. Production still runs `1.27.0`. Argo reports
`Synced` — to a revision that is not `HEAD`.

Someone disabled auto-sync after a bad rollout; `prune` and `selfHeal`
went with it. Git is desired state only if a controller reconciles it.
This is the inverse of the scale-reverted incident: there the cluster
could not drift from git; here git cannot reach the cluster.

## Your Task

- Apply the Application and confirm the live image is the old tag.
- Show a merge on `main` that does not move the cluster.
- Turn reconciliation back on in the Application — not `kubectl set image`.
- Prove a later git change arrives without clicking Sync.

## Starter Files

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels: { app: orders-api }
  template:
    metadata:
      labels: { app: orders-api }
    spec:
      containers:
        - name: api
          image: nginx:1.27.2-alpine
          ports: [{ containerPort: 80 }]
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: orders-api
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    # automated removed after the March incident
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
git log -1 --oneline -- manifests/deployment.yaml
# c0ffee1 bump orders-api to nginx:1.27.2-alpine

argocd app get orders-api
# Sync Status:    Synced to main (ab12cd0)   <- previous revision
# Auto Sync:      Disabled

kubectl -n shop get deploy orders-api -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.27.0-alpine
```

`Synced` means "matches the last revision we synced", not `origin/main`.
A one-shot `argocd app sync` hides the bug for one commit.

## Expected Outcome

```bash
argocd app get orders-api
# Sync Status:    Synced to main (c0ffee1)
# Health Status:  Healthy
# Auto Sync:      Enabled

kubectl -n shop get deploy orders-api -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.27.2-alpine
```

A further git bump follows on the next poll without `argocd app sync`.

## Hints

### Hint 1 — No `automated` means no reconcile from git

`automated:` missing is auto-sync off. `prune` and `selfHeal` only exist
inside `automated`. Sync options do not turn the loop on.

```bash
argocd app get orders-api | grep -i 'Auto Sync'
```

### Hint 2 — Clicking Sync is not the fix

`argocd app sync` applies *this* revision. The next merge sits until a
human notices. Put the policy on the Application so the controller
keeps the cluster on `main`.

## Solution

```yaml
syncPolicy:
  automated: { prune: true, selfHeal: true }
  syncOptions: ["CreateNamespace=true"]
```

```bash
# or: argocd app set orders-api --sync-policy automated --auto-prune --self-heal
argocd app wait orders-api --sync --health
```

- **Auto-sync off is break-glass**, not a steady state.
- **`Synced` is relative to the last compared revision.** Read Auto Sync
  and the SHA. `selfHeal` is the other direction (cluster → git).
- `kubectl set image` becomes the next drift ticket the moment auto-sync
  returns.
