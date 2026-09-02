# Immutable Service field: apply is not enough

## Briefing

You changed `Service.spec.selector` (or `clusterIP` in a way that
replaces the VIP). Git is right. Sync fails: `spec.selector: ... field
is immutable`.

Argo's default apply cannot change that field. You need **Replace** so
the controller recreates the object. kubectl-deleting the Service
yourself is the outage-shaped shortcut.

## Your Task

- Sync once with the old Service; then change selector in git.
- Capture the immutable-field error.
- Enable Replace (resource annotation or Application syncOptions).
- New selector is live; pods still targeted. Prefer controller replace
  over a manual delete.

## Starter Files

### file: manifests/service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: checkout
  namespace: shop
spec:
  type: ClusterIP
  selector: { app: checkout, version: v1 }
  ports:
    - { name: http, port: 80, targetPort: 80 }
```

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: checkout, namespace: shop }
spec:
  selector: { matchLabels: { app: checkout } }
  template:
    metadata: { labels: { app: checkout, version: v2 } }
    spec:
      containers: [{ name: api, image: nginx:1.27-alpine }]
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

After shipping `selector.version: v2` on the Service in git:

```bash
argocd app sync checkout
# Service/checkout  Failed
#   spec.selector: Invalid value: ... field is immutable

argocd app get checkout
# Sync Status: OutOfSync
# Operation:   Failed
```

Endpoints stay on `version=v1` pods (none), so the Service is empty.

## Expected Outcome

```bash
kubectl -n shop get svc checkout -o jsonpath='{.spec.selector}'
# {"app":"checkout","version":"v2"}
kubectl -n shop get endpoints checkout
# endpoints include the checkout pod
argocd app get checkout
# Sync Status:   Synced
# Health Status: Healthy
```

## Hints

### Hint 1 — Apply patches; some fields refuse patches

Service `selector`, `clusterIP`, some port mutations, PVC `accessModes`
— the API returns immutable. Argo reports SyncFailed.

### Hint 2 — Replace is an opt-in sync option

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-options: Replace=true
```

Application-wide `Replace=true` recreates everything — too blunt.
`Force=true` is for SSA conflicts; immutable fields want Replace.

## Solution

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-options: Replace=true
spec:
  selector: { app: checkout, version: v2 }
```

```bash
argocd app sync checkout
```

Argo recreates the Service (ClusterIP may change). That is why Replace
is opt-in. Do not `kubectl delete svc` as the runbook. This is not the
03 phantom `clusterIP: ""` loop; the apply is honestly rejected.
