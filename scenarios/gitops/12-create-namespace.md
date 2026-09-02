# Destination namespace does not exist

## Briefing

First sync of `orders-api` fails immediately. The error is
`namespaces "shop" not found`. The Application destination is `shop`.
Nobody created `shop`. `CreateNamespace` is not on the Application.

Argo does not invent namespaces unless you opt in. `kubectl create ns`
works until the next cluster and the next disaster recovery.

## Your Task

- Apply the Application against a cluster where `shop` is missing.
- Capture the namespace error.
- Fix it in the Application sync options (or a Namespace manifest in
  git). Do not make "remember to kubectl create ns" the runbook.
- Re-sync into a fresh namespace name once to prove it is repeatable.

## Starter Files

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 1
  selector:
    matchLabels: { app: orders-api }
  template:
    metadata:
      labels: { app: orders-api }
    spec:
      containers:
        - name: api
          image: nginx:1.27-alpine
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
    automated: { prune: true, selfHeal: true }
```

## Expected Failure

```bash
kubectl get ns shop
# NotFound

argocd app sync orders-api
# Namespace/shop  Failed
#   namespaces "shop" not found
```

`argocd app get` stays `OutOfSync`. Health is missing or `Missing`.

## Expected Outcome

```bash
kubectl get ns shop
# shop   Active

argocd app get orders-api
# Sync Status:   Synced
# Health Status: Healthy
```

Deleting `shop` and syncing again (or pointing destination at `shop-2`)
succeeds without a manual `kubectl create namespace`.

## Hints

### Hint 1 — Destination is not a Namespace object

`spec.destination.namespace: shop` is where namespaced resources go. It
is not a request to create `shop`. Without `CreateNamespace=true` or a
`kind: Namespace` in the path, the API server rejects every apply.

### Hint 2 — AppProject may still forbid it

If CreateNamespace is set and you still fail, the project
`clusterResourceWhitelist` may omit `Namespace`, or `destinations` may
omit `shop`. That error mentions the project, not `not found`.

## Solution

Opt in on the Application:

```yaml
syncPolicy:
  automated: { prune: true, selfHeal: true }
  syncOptions: ["CreateNamespace=true"]
```

or declare the namespace in git:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: shop
```

- **`CreateNamespace` creates the destination namespace only**, not extra
  namespaces named inside manifests.
- **Git-owned Namespace** is better when labels or PSA matter — those
  will not appear on a bare CreateNamespace.
- Do not leave `kubectl create ns shop` in the wiki as the install step.
