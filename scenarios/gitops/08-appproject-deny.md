# The repo is fine; the project refuses it

## Briefing

The Application will not sync. You can clone the URL. The error is not
401. It is Argo CD at the **AppProject** layer: `sourceRepos` or
`destinations` does not allow this repo, this cluster, or this
namespace.

`project: default` is wide open in a fresh install. This team uses a
locked-down `shop` project. The Application was pointed at it, or the
project was tightened after the app existed.

## Your Task

- Apply the Application and the AppProject as given.
- Capture the permission error from `argocd app get` / conditions.
- Change the **project** (or the app's project) so the repo and
  destination are allowed.
- Sync without moving the app to `project: default` unless that is
  policy.

## Starter Files

### file: appproject.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: shop
  namespace: argocd
spec:
  sourceRepos:
    - https://github.com/other-org/other-repo.git
  destinations:
    - namespace: staging
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: orders-api
  namespace: argocd
spec:
  project: shop
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
kubectl apply -f appproject.yaml -f application.yaml
argocd app get orders-api
# InvalidSpecError: application repo .../YOUR-REPO.git is not
# permitted in project 'shop'
```

After allowing the repo, the next error is the destination:

```
application destination {https://kubernetes.default.svc shop}
is not permitted in project 'shop'
```

The manifests never apply.

## Expected Outcome

```bash
argocd app get orders-api
# Project:       shop
# Sync Status:   Synced
# Health Status: Healthy
```

`sourceRepos` includes `YOUR-REPO.git`. Destinations include `{in-cluster, shop}`.

## Hints

### Hint 1 — Read `status.conditions`, not the git remote

```bash
kubectl -n argocd get application orders-api -o jsonpath='{.status.conditions}'
```

"not permitted in project" is AppProject, not credentials (401 is the
repo-creds drill).

### Hint 2 — `*` is allowed and is a decision

`sourceRepos: ["*"]` and `namespace: "*"` compile. They also defeat the
project. Prefer exact repo URLs (`.git` suffix must match) and the
namespaces the team owns.

## Solution

```yaml
spec:
  sourceRepos:
    - https://github.com/YOUR-USER/YOUR-REPO.git
  destinations:
    - namespace: shop
      server: https://kubernetes.default.svc
```

```bash
kubectl apply -f appproject.yaml
argocd app sync orders-api
```

- **AppProject is the tenancy boundary:** which git, cluster, namespace,
  and cluster-scoped kinds.
- **URL match is literal.** `repo` vs `repo.git`, and in-cluster vs a
  registered cluster URL, are denies. Empty
  `clusterResourceWhitelist` can still block Namespace after this error
  is gone.
- Do not `kubectl apply` the workload to skip the project.
