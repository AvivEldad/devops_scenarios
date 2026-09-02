# Phantom diffs from last-applied vs server-side apply

## Briefing

`checkout` flips OutOfSync with a diff nobody committed:
`kubectl.kubernetes.io/last-applied-configuration`,
`creationTimestamp: null`, empty `status: {}`. Someone kubectl-applied
the same objects Argo manages. Client-side apply writes last-applied;
Argo compares a normalized git tree. The fields are noise.

This is **not** the three-writer sync loop (HPA replicas, `:latest`,
`clusterIP: ""`). Nothing is fighting a controller over replicas. The
compare is comparing two apply styles.

## Your Task

- Sync with Argo, then `kubectl apply` the same live YAML dump.
- Show a phantom diff on annotations / defaulted fields.
- Normalize: ServerSideApply (or stop kubectl apply); drop last-applied
  from git. Do not ignoreDifferences the HPA path as the "fix".
- Diff empty while git is still.

## Starter Files

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels: { app: checkout }
  template:
    metadata:
      labels: { app: checkout }
    spec:
      containers:
        - name: api
          image: nginx:1.27.2-alpine
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
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
kubectl -n shop get deploy checkout -o yaml | kubectl apply -f -
argocd app diff checkout
# metadata.annotations.kubectl.kubernetes.io/last-applied-configuration
# or: spec.template.metadata.creationTimestamp: null
```

Git has no last-applied annotation. The live object does. selfHeal may
strip it, kubectl puts it back, and it flaps.

## Expected Outcome

```bash
argocd app diff checkout; echo exit=$?
# exit=0

kubectl -n shop get deploy checkout -o jsonpath='{.metadata.annotations}'
# no last-applied-configuration (or Argo owns apply via SSA)
```

Stay Synced for ten minutes with no git change.

## Hints

### Hint 1 — last-applied is an annotation kubectl apply owns

Client-side `kubectl apply` stores the last-applied blob. Argo's git
has no such key, so compare shows an extra annotation. `kubectl diff`
and `argocd app diff` do not normalize the same way.

### Hint 2 — Server-side apply is the GitOps-native apply

```yaml
syncOptions:
  - ServerSideApply=true
  - RespectIgnoreDifferences=true
```

SSA uses `managedFields`, not last-applied. Do **not** copy
`kubectl get -o yaml` into git (`status`, `uid`,
`creationTimestamp: null`). Field-level ignore for HPA replicas is a
different contract; leave it alone here.

## Solution

Stop mixing apply engines. Prefer Argo SSA and never kubectl-apply
managed objects:

```yaml
syncPolicy:
  automated: { prune: true, selfHeal: true }
  syncOptions:
    - CreateNamespace=true
    - ServerSideApply=true
```

If git contains last-applied / `status: {}`, delete those keys and
commit.

- **`ignoreDifferences` on `/metadata/annotations`** hides real
  annotation drift. Prefer not to.
- SelfHeal without SSA keeps stripping last-applied — quiet only until
  the next kubectl apply. The fix is the apply path, not more syncs.
