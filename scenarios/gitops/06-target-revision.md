# Tracking main locally, shipping staging in the cluster

## Briefing

You merged to `main`. Production still runs last Thursday's build.
`git log origin/main` and `argocd app get` disagree about the desired
commit. The Application `targetRevision` is `staging`, or a pinned SHA
from a hotfix nobody moved. Your laptop tracks `main`. Argo tracks
`spec.source.targetRevision`.

## Your Task

- Show HEAD of `main` vs the revision Argo reports as desired.
- Confirm live pods match the Argo revision, not `main`.
- Point the Application at the ref you actually intended.
- Prove the next commit on that ref is what syncs.

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
    targetRevision: staging
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
git rev-parse origin/main origin/staging
# 9aa1111  <- main, new image
# 4bb2222  <- staging, last week's pin

argocd app get orders-api
# Sync Status:  Synced to staging (4bb2222)

kubectl -n shop get deploy orders-api -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.27.0-alpine
```

Same failure with `targetRevision: 4bb2222`. Branch protection on `main`
never mattered. Argo never looked at `main`.

## Expected Outcome

```bash
argocd app get orders-api
# Sync Status:  Synced to main (9aa1111)
# Health Status: Healthy

git rev-parse origin/main
# 9aa1111

kubectl -n shop get deploy orders-api -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.27.2-alpine
```

## Hints

### Hint 1 — `targetRevision` is the desired git, not your checkout

```bash
argocd app get orders-api -o json | jq '.spec.source.targetRevision, .status.sync.revision'
```

`main`, `staging`, `v1.4.2`, or a SHA are all valid. Argo does not infer
the branch from your laptop.

### Hint 2 — A SHA never moves

Pinning `targetRevision: 4bb2222` is a freeze. Hotfix pins that nobody
bumps look exactly like "merges do nothing". Prefer a branch or a tag
CI actually updates.

## Solution

```yaml
source:
  repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
  targetRevision: main
  path: manifests
```

Commit the Application change and let it sync.

- **Local `main` is not the cluster's desired state.** The Application
  object is. Read `Synced to <ref> (sha)` before blaming the cache.
- **Environment apps should disagree on purpose.** The bug is a prod
  app left on the staging ref after a copy-paste.
- Do not `git checkout staging && git merge main` unless staging is
  actually the contract.
