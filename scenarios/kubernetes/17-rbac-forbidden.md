# The app that gets 403 from its own API server

## Briefing

A pod uses the Kubernetes API (via a client library or `kubectl` in-cluster) to list pods,
and every call returns `Forbidden`. The ServiceAccount exists and the token is mounted.

The ServiceAccount has no RBAC binding granting it the verbs it needs, or the Role and
RoleBinding are subtly mismatched (wrong name, wrong namespace, Role vs ClusterRole). The
identity is valid; it just is not authorized.

## Your Task

- Deploy the app with its ServiceAccount and reproduce the `Forbidden` error.
- Determine exactly which permission is missing.
- Grant least-privilege access so the call succeeds, without making it cluster-admin.

## Starter Files

### file: app.yaml

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: lister
  namespace: default
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lister
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels: { app: lister }
  template:
    metadata:
      labels: { app: lister }
    spec:
      serviceAccountName: lister
      containers:
        - name: kubectl
          image: bitnami/kubectl:1.30
          command: ["sh", "-c", "kubectl get pods; sleep 3600"]
# No Role/RoleBinding exists -> the 'lister' SA can do nothing.
```

## Expected Failure

```bash
kubectl apply -f app.yaml
kubectl logs deploy/lister
# Error from server (Forbidden): pods is forbidden:
# User "system:serviceaccount:default:lister" cannot list resource "pods"
# in API group "" in the namespace "default"
```

The ServiceAccount is authenticated (the message names it) but not authorized — there is no
Role granting `list pods` and no RoleBinding attaching such a Role to `lister`.

## Expected Outcome

The ServiceAccount can do exactly what it needs and no more.

A check with `auth can-i` confirms the grant:

```bash
kubectl auth can-i list pods \
  --as=system:serviceaccount:default:lister -n default
# yes
```

The app lists pods successfully:

```bash
kubectl logs deploy/lister
# NAME            READY   STATUS    ...
# lister-xxxx     1/1     Running   ...
```

It cannot do things it was not granted (still least-privilege):

```bash
kubectl auth can-i delete pods \
  --as=system:serviceaccount:default:lister -n default
# no
```

## Hints

### Hint 1 — Test permissions with `auth can-i --as`

```bash
kubectl auth can-i list pods --as=system:serviceaccount:default:lister -n default
```

This tells you yes/no without deploying anything. The `Forbidden` message also spells out
the exact verb, resource, API group and namespace that were denied — grant precisely those.

### Hint 2 — Role + RoleBinding, matched carefully

You need a Role (namespaced) listing the verbs/resources, and a RoleBinding tying that Role
to the ServiceAccount. Common mistakes: `roleRef` name does not match the Role; subject
namespace wrong; using a ClusterRole name in a RoleBinding without it existing. For
cluster-wide access use ClusterRole + ClusterRoleBinding instead.

## Solution

Create a least-privilege Role granting `get/list/watch` on pods and bind it to the
ServiceAccount.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: default
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: lister-can-read-pods
  namespace: default
subjects:
  - kind: ServiceAccount
    name: lister
    namespace: default
roleRef:
  kind: Role
  name: pod-reader          # must match the Role's name
  apiGroup: rbac.authorization.k8s.io
```

```bash
kubectl apply -f rbac.yaml
kubectl rollout restart deploy/lister
kubectl logs deploy/lister        # now lists pods
```

- **Forbidden = authenticated but not authorized.** The message names the identity, verb,
  resource, group and namespace — read it literally and grant exactly that.
- **`kubectl auth can-i ... --as=<sa>`** answers RBAC questions instantly, before and after
  you change bindings. It is the fastest RBAC debugger there is.
- **Role vs ClusterRole; RoleBinding vs ClusterRoleBinding.** Namespaced access uses
  Role+RoleBinding; cluster-wide (nodes, namespaces, or all-namespace access) needs the
  Cluster variants. Mixing them is a frequent cause of "it still says no".
- **`roleRef` is immutable and must match exactly.** A typo'd Role name or wrong `apiGroup`
  binds to nothing and denies silently. The subject's `namespace` must be the SA's namespace.
- **Grant least privilege.** Start from the denied verb/resource and add only that. `list`
  does not imply `get` or `watch` — list every verb the client actually calls.
- **The core API group is the empty string `""`** (pods, services, configmaps). Named groups
  (`apps`, `batch`, `networking.k8s.io`) must be spelled correctly in `apiGroups`.
