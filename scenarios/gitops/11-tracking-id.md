# OutOfSync extras that git never declared

## Briefing

`argocd app get` shows a ConfigMap as extra / orphaned. Git does not
have it. Someone applied it with kubectl, or stripped
`app.kubernetes.io/instance` / the tracking annotation.

Argo tracks ownership with a label and/or
`argocd.argoproj.io/tracking-id`. No tracking id means "not mine" —
an extra on the cluster, or a resource Argo will try to create again
next to the untracked copy.

## Your Task

- Sync the app from the starter manifests.
- Apply the extra ConfigMap with kubectl as in Expected Failure.
- Show it as an extra / OutOfSync resource Argo does not own.
- Make git the owner (add the manifest, or delete the orphan via prune).

## Starter Files

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: shop
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
    automated: { prune: false, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
kubectl -n shop apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata: { name: orders-api-flags, namespace: shop }
data: { debug: "true" }
EOF

argocd app get orders-api
# Sync Status: OutOfSync
# ConfigMap  shop  orders-api-flags  OutOfSync  (extra / not in git)

kubectl -n shop get cm orders-api-flags --show-labels
# no app.kubernetes.io/instance=orders-api
```

With prune off it stays forever. With prune on, Argo may delete it next
sync — a surprise if it was load-bearing.

## Expected Outcome

The ConfigMap is in git and tracked, or it is gone.

```bash
kubectl -n shop get cm orders-api-flags --show-labels
# app.kubernetes.io/instance=orders-api
argocd app get orders-api
# Sync Status: Synced
```

Or `kubectl -n shop get cm orders-api-flags` → NotFound.

## Hints

### Hint 1 — Tracking label is how Argo claims a resource

```bash
kubectl -n shop get deploy orders-api -o yaml | grep -E 'instance|tracking-id'
```

kubectl-applied objects lack these. They show as extras in the app's
destination namespace.

### Hint 2 — IgnoreExtraneous hides extras; it does not own them

`argocd.argoproj.io/compare-options: IgnoreExtraneous` on a parent makes
the UI quiet. The object is still untracked. Put it in git or delete it.
HPA `ignoreDifferences` is a different, field-level contract — not this
drill.

## Solution

If the flags ConfigMap is desired state, add it to git and enable prune:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-flags
  namespace: shop
data:
  debug: "true"
```

```yaml
syncPolicy:
  automated: { prune: true, selfHeal: true }
```

If it was junk, dry-run prune first, then let the controller delete it.

- **Never strip `app.kubernetes.io/instance` on a live object.** Argo may
  create a duplicate or leave an orphan. `resourceTrackingMethod` in
  `argocd-cm` must match what you inspect. Lasting objects go in the repo.
