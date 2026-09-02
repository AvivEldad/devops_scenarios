# Destination shop, live objects in default

## Briefing

The Application destination is namespace `shop`. `kubectl -n shop get all`
is empty. The Deployment is running in `default`. CreateNamespace created
`shop` and left it vacant.

Resources with `metadata.namespace` set do **not** inherit
`spec.destination.namespace`. A copied `kubectl get -o yaml` that still
says `namespace: default` wins.

## Your Task

- Sync the app and find where the Deployment actually landed.
- Explain destination vs `metadata.namespace`.
- Make git declare the namespace you meant (or omit it so destination
  applies). Do not leave a stray copy in `default`.

## Starter Files

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: default
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
    targetRevision: main
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
argocd app get orders-api
# DESTINATION  https://kubernetes.default.svc  shop
# GROUP  KIND        NAMESPACE  NAME        STATUS
# apps   Deployment  default    orders-api  Synced

kubectl -n shop get deploy orders-api
# NotFound
kubectl -n default get deploy orders-api
# orders-api   2/2
```

`shop` exists (CreateNamespace) and contains nothing you care about.

## Expected Outcome

```bash
argocd app get orders-api
# apps   Deployment  shop  orders-api  Synced  Healthy

kubectl -n shop get deploy orders-api
# orders-api   2/2
kubectl -n default get deploy orders-api
# NotFound
```

## Hints

### Hint 1 — Destination is a default, not an override

If the manifest omits `metadata.namespace`, Argo uses
`destination.namespace`. If the manifest sets it, that value is the
target. `CreateNamespace=true` creates the destination namespace, not
every namespace named in YAML.

### Hint 2 — Namespaced vs cluster-scoped

Cluster-scoped objects ignore destination namespace. Everything else
should omit `metadata.namespace` or match destination. Mixed values in
one path are how `default` gets prod.

## Solution

Drop `metadata.namespace` from namespaced manifests so destination owns
placement, or set it to `shop`. Enable prune so the copy in `default`
is removed once git no longer names that namespace.

```yaml
metadata:
  name: orders-api
  # namespace omitted — destination.namespace is shop
```

- **Do not `kubectl -n shop apply` a second Deployment.** You would have
  two copies until prune/selfHeal sort it out.
- **`argocd app get` RESOURCE NAMESPACE column** is the ground truth,
  not the DESTINATION line. AppProject destination denials are a later
  drill; here the objects simply went to `default`.
