# values.yaml bumped the tag; the cluster did not

## Briefing

CI wrote `image.tag: 1.27.2` into `values.yaml` and merged. The live
container is still `1.27.0`. Helm is the source type. The Application
also pins Helm parameters from the last promotion.

Application `parameters` / inline `values` beat `valueFiles` beat chart
defaults. Git's `values.yaml` lost. The Application object won.

## Your Task

- Render what Argo thinks the image is (`argocd app manifests`).
- Find the parameter or inline values that override `values.yaml`.
- Make the tag come from git.
- Live image must match `values.yaml` on `main`.

## Starter Files

### file: charts/orders/values.yaml

```yaml
image:
  repository: nginx
  tag: "1.27.2-alpine"
replicaCount: 2
```

### file: charts/orders/templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels: { app: orders-api }
  template:
    metadata:
      labels: { app: orders-api }
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
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
    path: charts/orders
    helm:
      valueFiles: [values.yaml]
      parameters:
        - name: image.tag
          value: "1.27.0-alpine"
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
grep tag charts/orders/values.yaml
#   tag: "1.27.2-alpine"

argocd app manifests orders-api | grep 'image:'
#         image: nginx:1.27.0-alpine

kubectl -n shop get deploy orders-api -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.27.0-alpine
```

`Synced` and `Healthy`. The override is doing its job.

## Expected Outcome

```bash
argocd app manifests orders-api | grep 'image:'
#         image: nginx:1.27.2-alpine

kubectl -n shop get deploy orders-api -o jsonpath='{.spec.template.spec.containers[0].image}'
# nginx:1.27.2-alpine
```

No leftover `helm.parameters` for `image.tag` unless CI writes that same
tag into the Application on every release.

## Hints

### Hint 1 — Parameters beat value files

Highest wins: `helm.parameters` / `--helm-set`, then inline
`helm.values`, then `valueFiles`, then chart `values.yaml`. A stale
`image.tag` parameter makes editing `values.yaml` a no-op.

### Hint 2 — Dump the merge

```bash
argocd app get orders-api -o yaml | grep -A20 'helm:'
argocd app manifests orders-api
```

If Application YAML still has `1.27.0` and git has `1.27.2`, git is not
the Helm root of truth for that key.

## Solution

Remove the stale parameter so `values.yaml` applies:

```yaml
helm:
  valueFiles: [values.yaml]
```

```bash
argocd app sync orders-api
```

- **One place owns the tag** — value files in git, or parameters written
  by the promotion pipeline, not both with different numbers. Inline
  `helm.values` and a wrong `valueFiles` path are the sibling bugs.
- `kubectl set image` would move live state until the next sync puts
  `1.27.0` back from the parameter.
