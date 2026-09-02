# Application deletion hangs on the finalizer

## Briefing

You deleted `checkout`. The Application sits in `Terminating` for an
hour. Workloads are still in `shop`. The object has
`resources-finalizer.argocd.argoproj.io`. Argo will not remove the
Application until it has deleted the managed resources — and one of them
will not die (its own finalizer, a PDB, a stuck Namespace).

Clearing the Application finalizer with kubectl orphans everything.
That is an escape hatch, not the first fix.

## Your Task

- Apply the app, then `kubectl delete application checkout`.
- Show Terminating + finalizer, and remaining child resources.
- Unblock the child (or prune with cascade), then confirm the
  Application object is gone.
- Do not leave production Deployments untracked unless that was the
  decision.

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
  selector:
    matchLabels: { app: checkout }
  template:
    metadata:
      labels: { app: checkout }
    spec:
      containers:
        - name: api
          image: nginx:1.27-alpine
```

### file: manifests/pdb.yaml

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: checkout
  namespace: shop
spec:
  minAvailable: 1
  selector:
    matchLabels: { app: checkout }
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: checkout
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
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
kubectl -n argocd delete application checkout
kubectl -n argocd get application checkout
# checkout   (deletionTimestamp set, still present)

kubectl -n argocd get application checkout -o jsonpath='{.metadata.finalizers}'
# ["resources-finalizer.argocd.argoproj.io"]

kubectl -n shop get deploy,pdb
# still there
```

## Expected Outcome

```bash
kubectl -n argocd get application checkout
# NotFound
kubectl -n shop get deploy checkout
# NotFound
```

## Hints

### Hint 1 — The finalizer is a cascade lock

`resources-finalizer.argocd.argoproj.io` means "delete children first".
Without it, `kubectl delete application` drops the CR and leaves
workloads (orphan). With it, one undeletable child blocks forever.

### Hint 2 — Find the child that is also Terminating

```bash
kubectl -n shop get all,pdb -o json | jq '.items[] | select(.metadata.deletionTimestamp) | .kind+"/"+.metadata.name'
```

Stuck pods, a Namespace finalizer, or `Delete=false` / `Prune=false`
sync-options on a resource will hold the app.

## Solution

```bash
kubectl -n shop delete pdb checkout --cascade=foreground
```

If you must abandon children, drop the Application finalizer **after**
recording they are snowflakes:

```bash
kubectl -n argocd patch application checkout --type merge \
  -p '{"metadata":{"finalizers":null}}'
```

Prefer removing the app from app-of-apps / ApplicationSet in git.
`Delete=false` on a PVC is how data survives — look there before
force-patching. This is CR deletion vs remaining live objects, not
prune-false orphans.
