# Parent app is Synced; the child Application was never created

## Briefing

App-of-apps: `root` should create `checkout` as an Application CR.
`root` is Synced and Healthy. `kubectl -n argocd get application` shows
only `root`. The child YAML lives under `apps/` while the parent path is
`bootstrap/`. A `sync-wave` on a file the parent does not render never
runs. If Application CRs are not in the rendered tree, no child exists.

## Your Task

- Apply the parent Application only.
- Show `root` Synced with no child Application.
- Fix parent `path` / recurse / wave so the child CR is created.
- Child must then sync its own workload. Do not `kubectl apply` the
  child CR as the fix.

## Starter Files

### file: bootstrap/root-note.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: root-ok
  namespace: argocd
data: { status: parent rendered this }
```

### file: apps/checkout/application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: checkout
  namespace: argocd
  annotations: { argocd.argoproj.io/sync-wave: "1" }
spec:
  project: default
  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: apps/checkout/manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

### file: apps/checkout/manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: checkout }
spec:
  selector: { matchLabels: { app: checkout } }
  template:
    metadata: { labels: { app: checkout } }
    spec:
      containers: [{ name: api, image: nginx:1.27-alpine }]
```

### file: root-application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: bootstrap
  destination: { server: https://kubernetes.default.svc, namespace: argocd }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

## Expected Failure

```bash
kubectl apply -f root-application.yaml
argocd app get root
# Sync Status: Synced
# ConfigMap argocd/root-ok  Synced

kubectl -n argocd get application
# NAME   SYNC STATUS   HEALTH
# root   Synced        Healthy
```

No `checkout`. Wave `1` never ran because the YAML was not in `bootstrap/`.

## Expected Outcome

```bash
kubectl -n argocd get application
# root       Synced  Healthy
# checkout   Synced  Healthy
kubectl -n shop get deploy checkout
# checkout   1/1
```

## Hints

### Hint 1 — Parent path is the only tree that becomes Applications

`path: bootstrap` renders `bootstrap/*.yaml`.
`apps/checkout/application.yaml` is unrelated git until path is `apps`
with recurse, or a kustomize that lists children.

### Hint 2 — Waves do not create files

`sync-wave: "1"` only orders apply **once the parent renders that
object**. An empty parent tree has no wave 1.

## Solution

```yaml
source:
  path: apps
  directory:
    recurse: true
    include: "{**/application.yaml,**/application.yml}"
```

Or keep `path: bootstrap` and resource the child Application YAML.
Include globs so the parent does not also apply child Deployments.
Do not kubectl-apply the child CR — the parent may later prune it.
