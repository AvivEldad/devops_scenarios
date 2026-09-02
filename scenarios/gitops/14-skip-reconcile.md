# Git changed; Argo skipped the object on purpose

## Briefing

`checkout-config` in git now has `LOG_LEVEL: debug`. The live ConfigMap
is still `info`. The Application is `Synced`. Diff is empty. An
annotation on the resource told Argo not to reconcile it.

`argocd.argoproj.io/reconcile: skip` stops management. Compare option
`IgnoreExtraneous` hides extras so they never look OutOfSync. Either way
git is no longer desired state for that object.

## Your Task

- Sync the app, then apply the annotated ConfigMap as given.
- Change the ConfigMap in git and show Argo still reports Synced with
  the old live value.
- Remove the skip / ignore annotation from git (the manifest).
- Prove the next git edit applies.

## Starter Files

### file: manifests/configmap.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-config
  namespace: shop
  annotations:
    argocd.argoproj.io/reconcile: skip
    argocd.argoproj.io/compare-options: IgnoreExtraneous
data:
  LOG_LEVEL: info
```

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
          envFrom:
            - configMapRef: { name: checkout-config }
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

Edit git to `LOG_LEVEL: debug`, push, wait:

```bash
argocd app get checkout
# Sync Status:   Synced
argocd app diff checkout
# (empty)
kubectl -n shop get cm checkout-config -o jsonpath='{.data.LOG_LEVEL}'
# info
```

The Deployment is Synced. The ConfigMap is a hole in GitOps.

## Expected Outcome

```bash
kubectl -n shop get cm checkout-config -o jsonpath='{.data.LOG_LEVEL}'
# debug
argocd app diff checkout; echo exit=$?
# exit=0
```

No `reconcile: skip` / `IgnoreExtraneous` on this object.

## Hints

### Hint 1 — Skip means "not a managed resource"

`argocd.argoproj.io/reconcile: skip` tells the controller not to compare
or update that object. `Synced` is then vacuously true for it. Used as a
debug sticker, it becomes a permanent drift pocket.

### Hint 2 — IgnoreExtraneous is for children you do not own

`compare-options: IgnoreExtraneous` is for extras under a parent (Jobs
spawned by a CronJob). On the ConfigMap you *do* own, it hides the
problem. HPA `ignoreDifferences` is a different contract — not this
drill.

## Solution

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: checkout-config, namespace: shop }
data: { LOG_LEVEL: debug }
```

Commit, push, wait for auto-sync. Drop both skip annotations so the
object is desired state again. A kubectl-only skip can persist if skip
prevents selfHeal from removing it.
