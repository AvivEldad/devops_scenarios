# The Application that syncs nothing from a full repo

## Briefing

`checkout` is `Synced` and `Healthy` with zero resources. The Deployment
is in git. The UI tree is empty. `spec.source.path` points at a
directory that does not contain manifests — or that does not exist.

Argo compares the cluster to whatever that path renders. An empty path
is a successful empty desired state. The controller applied nothing.

## Your Task

- Apply the Application and show it is empty while git is not.
- Find the path Argo is actually rendering.
- Point it at the directory that holds the manifests, in git.
- Confirm the Deployment appears and becomes `Healthy`.

## Starter Files

### file: deploy/checkout/deployment.yaml

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
          ports: [{ containerPort: 80 }]
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
    path: apps/checkout
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
argocd app get checkout
# Sync Status:   Synced
# Health Status: Healthy
# Source path:   apps/checkout

argocd app resources checkout
# (empty)

kubectl -n shop get deploy checkout
# Error from server (NotFound): deployments.apps "checkout" not found
```

If the directory is missing, repo-server logs `ComparisonError: application
source path 'apps/checkout' does not exist`. If it exists and is empty
(README only), there is no error — only an empty app.

## Expected Outcome

```bash
argocd app get checkout
# GROUP  KIND        NAMESPACE  NAME      STATUS  HEALTH
# apps   Deployment  shop       checkout  Synced  Healthy

kubectl -n shop get deploy checkout
# NAME       READY
# checkout   1/1
```

`git ls-tree` of that path lists `deployment.yaml`.

## Hints

### Hint 1 — `path` is a git directory, not a folder you remember

```bash
git ls-tree --name-only HEAD deploy/checkout
```

Argo never searches the repo. `apps/checkout` vs `deploy/checkout` is a
typo that looks like a healthy app.

### Hint 2 — Empty is a successful desired state

`Synced` with no resources means desired = live = nothing. Read
`status.source.path` and `status.conditions` before debugging the
workload.

## Solution

```yaml
source:
  repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
  targetRevision: main
  path: deploy/checkout
```

Commit, push, let auto-sync run.

- **Path is relative to the repo root.** Helm/Kustomize need the chart
  or `kustomization.yaml` at that path.
- **A missing path is an error; an empty path is silence.** Check
  `status.resources` length, not only Sync Status.
- Do not `kubectl apply -f deploy/checkout`. That creates an untracked
  copy the moment the path is fixed.
