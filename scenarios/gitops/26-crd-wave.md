# Custom resource applied before the CRD is established

## Briefing

First sync of `widgets` fails: `no matches for kind "Widget" in version
"demo.example.com/v1"`. Retry often works. The CRD and the CR are in
the same wave (default 0). Argo applies the CR before apiserver has
`Established=True` on the CRD.

Argo can wait if the CRD is wave `-1` (and skip dry-run on the CR).
kubectl applying the CR after a coffee break is not GitOps.

## Your Task

- Sync a fresh cluster/namespace with CRD + CR in one path.
- Capture the missing kind / dry-run error on the first attempt.
- Wave the CRD (and optionally skip dry-run on the CR).
- Delete the CRD/CR and sync once; first attempt must succeed.

## Starter Files

### file: manifests/crd.yaml

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.demo.example.com
spec:
  group: demo.example.com
  names: { kind: Widget, plural: widgets, singular: widget }
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                size: { type: string }
```

### file: manifests/widget.yaml

```yaml
apiVersion: demo.example.com/v1
kind: Widget
metadata:
  name: checkout
  namespace: shop
spec:
  size: small
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: widgets
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
argocd app sync widgets
# Widget/checkout  Failed
#   no matches for kind "Widget" in version "demo.example.com/v1"
```

Dry-run may fail even when a retry works. `Established` may still be
False during the same apply batch.

## Expected Outcome

```bash
argocd app sync widgets
argocd app get widgets
# CustomResourceDefinition  widgets.demo.example.com  Synced  Healthy
# Widget                    shop/checkout             Synced  Healthy
```

Wipe CRD+CR and sync again; still success on attempt one.

## Hints

### Hint 1 — Same wave is concurrent enough to lose

Default wave `0` applies CRD and CR together. The apiserver needs the
CRD `Established` condition. Put the CRD in a lower wave so Argo waits
for health.

### Hint 2 — Dry-run runs before the CRD exists

Even with waves, **client dry-run** can reject the CR. On the CR:

```yaml
argocd.argoproj.io/sync-options: SkipDryRunOnMissingResource=true
```

Argo's default CRD health treats `Established` as healthy.

## Solution

```yaml
# crd.yaml metadata.annotations
argocd.argoproj.io/sync-wave: "-1"
```

```yaml
# widget.yaml metadata.annotations
argocd.argoproj.io/sync-wave: "0"
argocd.argoproj.io/sync-options: SkipDryRunOnMissingResource=true
```

```bash
argocd app sync widgets
kubectl get widget -n shop checkout
```

- This is **not** Job-before-Secret waves — the dependency is apiserver
  schema. Helm `crds/` vs `templates/` has the same race. A second sync
  succeeding is a trap: CI must test empty-cluster first apply.
