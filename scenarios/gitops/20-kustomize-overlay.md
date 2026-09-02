# Prod Application pointed at the dev overlay

## Briefing

Production checkout still has `replicas: 1` and `image: nginx:1.27.0`.
The prod overlay sets replicas 4 and patches the image to `1.27.2`. The
Application `path` is `overlays/dev` — copied from the dev app and never
changed.

Kustomize only builds the overlay you named. `overlays/prod` is not
desired state until `spec.source.path` says so.

## Your Task

- Sync and show live image / replica count from the **dev** overlay.
- Diff git `overlays/prod` vs what `argocd app manifests` emits.
- Point the prod Application at `overlays/prod`.
- Confirm patches apply; do not kubectl scale or set image.

## Starter Files

### file: base/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
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
          image: nginx:1.27.0-alpine
```

### file: overlays/dev/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: ["../../base"]
```

### file: overlays/prod/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: ["../../base"]
images:
  - { name: nginx, newTag: 1.27.2-alpine }
replicas:
  - { name: checkout, count: 4 }
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: checkout-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: overlays/dev
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
kustomize build overlays/prod | grep -E 'replicas:|image:'
# replicas: 4
# image: nginx:1.27.2-alpine

argocd app manifests checkout-prod | grep -E 'replicas:|image:'
# replicas: 1
# image: nginx:1.27.0-alpine
```

App is Synced. Prod overlay is unused.

## Expected Outcome

```bash
argocd app get checkout-prod
# Path: overlays/prod
# Sync Status: Synced

kubectl -n shop get deploy checkout -o jsonpath='{.spec.replicas} {.spec.template.spec.containers[0].image}'
# 4 nginx:1.27.2-alpine
```

## Hints

### Hint 1 — Path is the overlay directory, not `base`

`kustomize build overlays/prod` is what Argo runs when `path:
overlays/prod`. `path: overlays/dev` is a different desired state that
happens to share a base.

### Hint 2 — `spec.source.kustomize.images` is a second patch layer

Application-level `kustomize.images` can pin an old tag on top of a
correct overlay (same class of bug as Helm parameters). If path is
already prod and the image is still wrong, look there next.

## Solution

```yaml
source:
  repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
  targetRevision: main
  path: overlays/prod
```

Commit the Application (or ApplicationSet template), let it sync.

- **Name the app after the overlay** (`checkout-prod`) so a
  `path: overlays/dev` copy-paste is obvious in review.
- **Directory recurse on `overlays/`** would apply dev and prod as raw
  YAML and clash. One Application, one overlay path.
- kubectl scale 4 would be reverted to 1 until the path is fixed
  (selfHeal against the *dev* tree).
