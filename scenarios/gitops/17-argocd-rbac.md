# Local user can see the app and cannot sync it

## Briefing

`alice` can open checkout in the UI. Sync returns `permission denied`.
SSO/local login works. The role in `policy.csv` grants `get` (and maybe
`action/apps/...`) but not `sync` / `override` / `update`.

Argo CD RBAC is not Kubernetes RBAC. `argocd-rbac-cm` `policy.csv` is
the map. Viewers who were copied from `role:readonly` cannot ship git.

## Your Task

- Install the policy as given and log in as the local user (or `argocd
  account`).
- Show `app get` works and `app sync` is denied.
- Grant the minimum verbs needed to sync this app (or this project).
- Prove sync succeeds without making the user `role:admin`.

## Starter Files

### file: argocd-rbac-cm.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  policy.default: role:readonly
  policy.csv: |
    p, role:shop-dev, applications, get, shop/*, allow
    p, role:shop-dev, applications, get, default/checkout, allow
    g, alice, role:shop-dev
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: checkout
  namespace: argocd
spec:
  project: shop
  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
```

## Expected Failure

```bash
argocd login localhost:8080 --username alice --password '...'
argocd app get checkout
# Sync Status: OutOfSync   (readable)

argocd app sync checkout
# FATA[0000] rpc error: code = PermissionDenied desc = permission denied
```

UI: Sync button missing or toast "Permission denied". Logs of
`argocd-server` show `alice` / `role:shop-dev` vs verb `sync`.

## Expected Outcome

Alice can sync `shop/*` (or `checkout` only). She still cannot delete
the AppProject or change admin.

```bash
argocd app sync checkout
# application 'checkout' synced

argocd app get checkout
# Sync Status: Synced
```

```bash
# still denied:
argocd proj delete shop
# permission denied
```

## Hints

### Hint 1 — `get` is not `sync`

CSV columns: `p, <role>, <resource>, <action>, <object>, allow|deny`.
Actions on applications include `get`, `create`, `update`, `delete`,
`sync`, `override`, `action/*`. Readonly is get+list. Sync is its own
verb.

### Hint 2 — Object is `project/app`, not namespace

`applications, sync, shop/*` is all apps in AppProject `shop`.
`default/checkout` is project `default`, app `checkout`. A policy on
`shop/checkout` does nothing if `spec.project` is `default`.

## Solution

Add sync (and update if they need to edit the spec) for that role:

```text
p, role:shop-dev, applications, get, shop/*, allow
p, role:shop-dev, applications, sync, shop/*, allow
p, role:shop-dev, applications, update, shop/*, allow
g, alice, role:shop-dev
```

Apply the ConfigMap; RBAC reloads without a restart in current Argo:

```bash
kubectl -n argocd apply -f argocd-rbac-cm.yaml
argocd app sync checkout
```

- **`policy.default: role:readonly`** is why everyone else can view.
  Do not flip default to admin to "just make sync work".
- **SSO groups** use `g, org:team-shop, role:shop-dev`. Local users are
  `g, alice, role:shop-dev`. Mixing them up looks like "login works,
  policy does not".
- Kubernetes `Role` in namespace `shop` does not grant Argo UI verbs.
- Syncing as admin from your laptop is not a fix for Alice's incident
  role.
