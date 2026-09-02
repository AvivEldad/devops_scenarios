# Destination server URL does not match any cluster secret

## Briefing

`checkout` is `Unknown` / `InvalidSpecError`: destination cluster is
not defined. The cluster Secret `name` is `prod-eu`. The Application
sets both `destination.name: prod-eu` and `destination.server:
https://kubernetes.default.svc`. Or the Secret's `server` is
`https://prod-eu.example.com:6443` and the app uses the URL without a
port.

Argo matches **server URL strings** (or `destination.name` to the
secret's `name` data). A UI "cluster name" is not a DNS lookup.

## Your Task

- Register the cluster Secret as given and apply the Application.
- Capture the unknown-cluster / conflicting-destination condition.
- Make destination `server` or `name` match the Secret — not both.
- App must sync to that cluster.

## Starter Files

### file: cluster-secret.yaml

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: prod-eu
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: cluster
type: Opaque
stringData:
  name: prod-eu
  server: https://prod-eu.example.com:6443
  config: |
    {"tlsClientConfig":{"insecure":false}}
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
  destination:
    name: prod-eu
    server: https://kubernetes.default.svc
    namespace: shop
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
kubectl apply -f cluster-secret.yaml -f application.yaml
argocd app get checkout
# InvalidSpecError: two conflicting destination definitions
# or: Destination cluster 'https://prod-eu.example.com' is not defined

argocd cluster list
# SERVER                              NAME       STATUS
# https://prod-eu.example.com:6443    prod-eu    Successful
# https://kubernetes.default.svc      in-cluster Successful
```

## Expected Outcome

```bash
argocd app get checkout
# Destination: https://prod-eu.example.com:6443
# (or name: prod-eu only)
# Sync Status: Synced   (if that cluster is reachable)
```

## Hints

### Hint 1 — `name` and `server` together are invalid

Set **either** `destination.name: prod-eu` **or**
`destination.server: https://prod-eu.example.com:6443`, not both. Name
maps to the Secret `stringData.name`, not necessarily `metadata.name`.

### Hint 2 — URL match is literal

`:6443` vs no port, trailing slash, `http` vs `https` are different
clusters. Copy the SERVER column from `argocd cluster list`.

## Solution

```yaml
destination:
  name: prod-eu
  namespace: shop
```

or `server: https://prod-eu.example.com:6443` and no `name`.

```bash
kubectl apply -f application.yaml
argocd app get checkout
```

- **In-cluster is `https://kubernetes.default.svc`** (or `name:
  in-cluster`). Mixing that server with `name: prod-eu` is this
  incident.
- **Missing `argocd.argoproj.io/secret-type: cluster`** makes a Secret
  that is not a cluster. AppProject `destinations.server` must allow
  the URL too.
- Do not apply manifests with `kubectl --context prod-eu` as the GitOps
  fix.
