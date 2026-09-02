# The pod that mounts a secret it should never see

## Briefing

A security review finds that a low-trust workload can read a Secret belonging to another
team, and that its ServiceAccount token grants far more than intended. Nothing is "broken" —
everything works — which is exactly the problem.

The Secret is exposed through an over-broad RBAC grant (a wildcard ClusterRole), the pod
auto-mounts a powerful ServiceAccount token it does not need, and the Secret is readable by
anyone who can `get secrets` in the namespace. This is a least-privilege and blast-radius
drill.

## Your Task

- Show that the workload's ServiceAccount can read Secrets it should not.
- Identify the over-broad grant and the unnecessary token automount.
- Tighten access to least privilege and stop mounting the token where it is not needed.

## Starter Files

### file: bad-rbac.yaml

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: batch
  namespace: team-a
# automountServiceAccountToken defaults to true -> token mounted into every pod
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: too-powerful
rules:
  - apiGroups: ["*"]           # wildcard everything
    resources: ["*"]
    verbs: ["*"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: batch-is-admin
subjects:
  - kind: ServiceAccount
    name: batch
    namespace: team-a
roleRef:
  kind: ClusterRole
  name: too-powerful           # a batch job bound to cluster-wide admin
  apiGroup: rbac.authorization.k8s.io
```

## Expected Failure

```bash
kubectl apply -f bad-rbac.yaml

# the batch SA can read secrets anywhere, including other teams:
kubectl auth can-i get secrets -n team-b \
  --as=system:serviceaccount:team-a:batch
# yes        <- should be 'no'

kubectl auth can-i '*' '*' --all-namespaces \
  --as=system:serviceaccount:team-a:batch
# yes        <- effectively cluster-admin
```

A `*/*/*` ClusterRole bound cluster-wide gives a batch job full control of the cluster, and
the auto-mounted token means any compromise of that pod hands an attacker those rights.
Everything "works" — the risk is invisible until abused.

## Expected Outcome

The workload has only the access it needs, and no token where it does not.

The SA can no longer read other teams' Secrets or act cluster-wide:

```bash
kubectl auth can-i get secrets -n team-b \
  --as=system:serviceaccount:team-a:batch
# no

kubectl auth can-i '*' '*' --all-namespaces \
  --as=system:serviceaccount:team-a:batch
# no
```

It retains exactly the narrow access it genuinely needs (example: read one ConfigMap in its
own namespace):

```bash
kubectl auth can-i get configmaps -n team-a \
  --as=system:serviceaccount:team-a:batch
# yes
```

Pods that do not call the API do not mount a token:

```bash
kubectl get pod <batch-pod> -o jsonpath='{.spec.automountServiceAccountToken}{"\n"}'
# false
```

## Hints

### Hint 1 — Never use wildcard RBAC for workloads

`apiGroups/resources/verbs: ["*"]` is cluster-admin in disguise. Replace it with a Role (or
narrow ClusterRole) listing only the specific resources and verbs the workload uses. Prefer
namespaced Role+RoleBinding over ClusterRoleBinding so access cannot cross namespaces.

### Hint 2 — Do not mount tokens you do not use

If a pod never calls the Kubernetes API, set `automountServiceAccountToken: false` on the
pod (or the ServiceAccount). This removes a powerful credential from the container entirely,
shrinking the blast radius if the pod is compromised. Secrets used by the app should be
mounted read-only and scoped to that app.

## Solution

Replace the wildcard grant with a least-privilege namespaced Role, and disable token
automount where it is not needed.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: batch
  namespace: team-a
automountServiceAccountToken: false      # not mounted unless a pod opts in
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role                                # namespaced, not cluster-wide
metadata:
  name: batch-minimal
  namespace: team-a
rules:
  - apiGroups: [""]
    resources: ["configmaps"]            # only what it actually needs
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: batch-minimal
  namespace: team-a
subjects:
  - kind: ServiceAccount
    name: batch
    namespace: team-a
roleRef:
  kind: Role
  name: batch-minimal
  apiGroup: rbac.authorization.k8s.io
```

```bash
kubectl apply -f good-rbac.yaml
# delete the dangerous binding
kubectl delete clusterrolebinding batch-is-admin
kubectl delete clusterrole too-powerful

# verify blast radius shrank
kubectl auth can-i '*' '*' --all-namespaces --as=system:serviceaccount:team-a:batch  # no
```

- **Wildcard RBAC (`*`) is cluster-admin.** Never grant it to a workload. Enumerate the exact
  resources and verbs; `kubectl auth can-i --as` proves what the identity can and cannot do.
- **Prefer namespaced Role+RoleBinding.** A ClusterRoleBinding lets an identity act in every
  namespace, breaking tenant isolation. Keep access inside the namespace that owns the
  workload.
- **Disable token automount when unused.** `automountServiceAccountToken: false` removes a
  high-value credential from pods that never call the API — a big reduction in blast radius
  for a one-line change.
- **Secrets are only as safe as `get secrets`.** Anyone who can read Secrets in a namespace
  reads them all; scope RBAC tightly and consider separate namespaces per trust boundary.
- **Think in blast radius.** Assume any pod can be compromised, then ask what its token and
  RBAC would let an attacker do. Least privilege is the design goal, not an afterthought.
- **Enforce with policy.** Admission tools (OPA/Gatekeeper, Kyverno) can reject wildcard
  ClusterRoles and default `automount` to false cluster-wide, so this cannot regress.
