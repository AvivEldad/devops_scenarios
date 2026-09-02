# Multi-source ref name does not match $values

## Briefing

Checkout is a Helm chart from a chart repo plus values from git
(multi-source). The live image is the chart default, not
`gitops/checkout/values.yaml`. Rendered manifests ignore the git file.

`helm.valueFiles: $values/...` must match `ref: values` on the other
source. A typo (`$vals`, `ref: value`, wrong path) is a silent default,
not always a missing-file error.

## Your Task

- Apply the multi-source Application.
- Show rendered image ≠ git values file.
- Fix `ref` / `$<ref>/path` so the git values are used.
- Live image must match the git file.

## Starter Files

### file: gitops/checkout/values.yaml

```yaml
image:
  registry: docker.io
  repository: nginx
  tag: 1.27.2-alpine
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
  sources:
    - repoURL: https://charts.bitnami.com/bitnami
      chart: nginx
      targetRevision: 18.1.6
      helm:
        valueFiles:
          - $vals/gitops/checkout/values.yaml
    - repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
      targetRevision: main
      ref: values
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
argocd app get checkout
# Sources:
# 0  charts.bitnami.com  nginx  18.1.6
# 1  YOUR-REPO.git  (ref: values)

argocd app manifests checkout | grep -A1 'image:'
# chart default tag, not 1.27.2-alpine
```

Conditions may mention unable to load `$vals/...`, or the sync succeeds
on defaults with no condition.

## Expected Outcome

```bash
argocd app manifests checkout | grep '1.27.2-alpine'
argocd app get checkout
# Sync Status:   Synced
# Health Status: Healthy
```

## Hints

### Hint 1 — `$name` is the other source's `ref`

```yaml
- helm:
    valueFiles:
      - $values/gitops/checkout/values.yaml
- ref: values
```

`$vals` plus `ref: values` is two different names. The chart source
cannot see the git tree.

### Hint 2 — Path is inside the ref'd repo

`$values/gitops/checkout/values.yaml` is relative to that git repo
root, not to the chart. `argocd app manifests` is the merge you ship.

## Solution

Make the placeholder and `ref` identical:

```yaml
sources:
  - repoURL: https://charts.bitnami.com/bitnami
    chart: nginx
    targetRevision: 18.1.6
    helm:
      valueFiles:
        - $values/gitops/checkout/values.yaml
  - repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    ref: values
```

```bash
argocd app sync checkout --hard-refresh
```

- **Multi-source `ref` is not `path`.** The values source often has no
  `path`/`chart`; it exists to be mounted into Helm.
- **Parameters on the chart source still override** the git file (Helm
  values drill). Do not `kubectl set image`; the next sync puts the
  chart default back until `$ref` is fixed.
