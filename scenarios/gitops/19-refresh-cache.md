# Git moved; Argo's compare cache did not

## Briefing

You force-pushed a fix (or the Helm repo index went stale).
`git show origin/main:manifests/deployment.yaml` has the new probe.
`argocd app get` still diffs the old tree. Soft refresh does nothing.
The controller is comparing **cached generated manifests**, not a fresh
git fetch + render.

This is not a sync loop and not a wrong `targetRevision`. Hard refresh
invalidates the repo-server cache.

## Your Task

- Point the Application at a revision whose cache is stale (amend,
  retag, or a Helm chart already pulled).
- Show `argocd app get --refresh` still old, git already new.
- Hard-refresh and confirm manifests match git.
- Leave auto-sync on so the cluster follows the uncached render.

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
          readinessProbe:
            httpGet: { path: /readyz, port: 80 }
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
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

After rewriting `main` or retagging (same ref, different tree):

```bash
git show origin/main:manifests/deployment.yaml | grep path:
# path: /readyz

argocd app get orders-api --refresh
# manifests still have path: /

argocd app diff orders-api
# no /readyz in desired
```

Repo-server has a cache hit. Status revision may equal HEAD while the
rendered YAML is old.

## Expected Outcome

```bash
argocd app get orders-api --hard-refresh
argocd app manifests orders-api | grep path:
# path: /readyz

argocd app get orders-api
# Sync Status:   Synced to main (<current sha>)
# Health Status: Healthy
```

## Hints

### Hint 1 — Refresh vs hard refresh

`--refresh` re-compares using cached generated manifests.
`--hard-refresh` asks repo-server to ignore cache and regenerate (git
fetch, helm pull, kustomize build). UI: Refresh vs Hard Refresh.
Annotation `argocd.argoproj.io/refresh: hard` is the same signal.

### Hint 2 — Helm chart repos cache by version

If the **chart** `targetRevision` did not change, repo-server may keep
the old tarball. Bump the chart version, or hard-refresh. Git SHA
changes force-pushed onto the same ref are the other classic cache key
collision.

## Solution

```bash
argocd app get orders-api --hard-refresh
# equivalent:
kubectl -n argocd annotate application orders-api \
  argocd.argoproj.io/refresh=hard --overwrite
argocd app wait orders-api --sync --health
```

- **Do not restart repo-server as the first fix.** Hard refresh is the
  API. Restarts lose cache for everyone.
- **Avoid force-push on refs Argo tracks.** Prefer new commits. If hard
  refresh is still old, you are on the wrong `targetRevision` or repo
  URL.
