# Nested overlays exist in git and never sync

## Briefing

`env/prod/deployment.yaml` is on `main`. Argo lists only the top-level
`namespace.yaml`. Production is missing the Deployment. The Application
uses a plain directory source. `directory.recurse` defaults to **false**.

Argo does not walk the tree unless you tell it to. Nested `env/` and
`overlays/` directories are invisible desired state.

## Your Task

- Sync and list which files Argo rendered.
- Show nested manifests are in git and not in `status.resources`.
- Enable recursion (or flatten / switch to Kustomize) so nested files
  apply.
- Confirm the prod Deployment is live.

## Starter Files

### file: manifests/namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: shop
```

### file: manifests/env/prod/deployment.yaml

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
    directory:
      recurse: false
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

## Expected Failure

```bash
git ls-files manifests
# manifests/namespace.yaml
# manifests/env/prod/deployment.yaml

argocd app get orders-api
# GROUP  KIND       NAMESPACE  NAME  STATUS  HEALTH
#        Namespace             shop  Synced  Healthy
```

No Deployment row. Sync Status is still `Synced`.

## Expected Outcome

```bash
argocd app get orders-api
# Namespace              shop        Synced  Healthy
# Deployment  shop       orders-api  Synced  Healthy

kubectl -n shop get deploy orders-api
# orders-api   2/2
```

## Hints

### Hint 1 — Directory apps are not recursive

Omitted `directory:` is `recurse: false`. Only `*.yaml` / `*.yml` /
`*.json` in that one folder are desired state.

### Hint 2 — Recurse is the wrong tool if this is Kustomize

If `env/prod` is an overlay with `kustomization.yaml`, set `path:
manifests/env/prod` and drop recurse. Recursing a kustomize tree applies
bases *and* overlays as raw YAML and duplicates objects.

## Solution

For a flat tree of raw manifests:

```yaml
source:
  path: manifests
  directory:
    recurse: true
```

Or stop nesting: `path: manifests/env/prod` and keep recurse off.

```bash
argocd app manifests orders-api | grep -E '^kind:'
```

- **`Synced` plus a missing kind** means the kind is not in the rendered
  tree. Recurse, path, and kustomize overlay are the usual three.
- **`directory.include` / `exclude`** can hide `env/**` even with recurse
  true. Helm/Kustomize sources ignore `directory.recurse`.
- Do not `kubectl apply -f manifests/env/prod` to paper over a path the
  Application still does not render.
