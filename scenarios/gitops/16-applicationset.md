# ApplicationSet never created the EU app

## Briefing

Prod-us has a `checkout` Application. Prod-eu does not. The ApplicationSet
is `Healthy`. The git generator glob does not match the EU overlay path
(or the cluster generator selector misses the EU cluster secret).

ApplicationSet only creates Applications the generator emits. A missing
app is not a failed sync; it is a path or label that never produced a
row.

## Your Task

- Apply the ApplicationSet and two git overlay dirs (or two clusters).
- Show only one Application appears.
- Fix the generator path / selector so both clusters get an app.
- Do not kubectl-create the missing Application by hand.

## Starter Files

### file: apps/checkout/overlays/{us,eu}/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: ["../../base"]
```

### file: apps/checkout/base/deployment.yaml

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
          image: nginx:1.27-alpine
```

### file: applicationset.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: checkout
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
        revision: main
        directories:
          - path: apps/checkout/overlays/prod-*
  template:
    metadata:
      name: "checkout-{{path.basename}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
        targetRevision: main
        path: "{{path}}"
      destination:
        server: https://kubernetes.default.svc
        namespace: shop
      syncPolicy:
        automated: { prune: true, selfHeal: true }
        syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
kubectl -n argocd get applications.argoproj.io
# NAME            SYNC STATUS   HEALTH
# checkout-us     Synced        Healthy
# (no checkout-eu)
```

Git has `overlays/eu` and `overlays/us`. The glob is `overlays/prod-*`.

## Expected Outcome

```bash
kubectl -n argocd get applications.argoproj.io
# checkout-eu    Synced        Healthy
# checkout-us    Synced        Healthy

argocd app get checkout-eu
# Source path: apps/checkout/overlays/eu
```

## Hints

### Hint 1 — The generator is a filter, not a search

`directories.path: apps/checkout/overlays/prod-*` only emits directories
that match. `eu` / `us` never match `prod-*`.

```bash
git ls-tree -d --name-only HEAD apps/checkout/overlays
```

### Hint 2 — Cluster generators fail the same way

An EU cluster secret without `matchLabels: { region: us }` never gets
an app. `kubectl -n argocd get secret -l argocd.argoproj.io/secret-type=cluster`.

## Solution

Match the directories you actually ship:

```yaml
directories:
  - path: apps/checkout/overlays/*
```

Commit, apply the ApplicationSet, wait for the controller.

- **Do not `kubectl apply` a one-off Application for EU.** The next
  generator reconcile may fight it. `goTemplate` `{{.path.path}}` vs
  `{{path}}` is a common empty `spec.source.path`. Blast-radius /
  `applicationsSync` is a later drill; here apps are **missing**.
