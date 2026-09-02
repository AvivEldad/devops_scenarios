# ApplicationSet rolled the bad app to every cluster

## Briefing

A typo in the generator's shared template shipped `image: nginx:broken`
to every cluster in one reconcile. ApplicationSet
`syncPolicy.applicationsSync` is `sync` (create+update+delete). There is
no RollingSync. GitOps scaled the blast radius.

The generator is doing what it was told. Progressive sync and a stricter
`applicationsSync` are how "one overlay" does not mean "the fleet".

## Your Task

- Apply the ApplicationSet with a list generator of 3+ targets.
- Change the template to a bad image; show all child apps update at
  once.
- Put RollingSync and a safer `applicationsSync` in git.
- A later bad change must update the canary cluster first, not all.

## Starter Files

### file: applicationset.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: checkout
  namespace: argocd
spec:
  syncPolicy:
    applicationsSync: sync
  generators:
    - list:
        elements:
          - { url: https://kubernetes.default.svc, env: canary }
          - { url: https://kubernetes.default.svc, env: eu }
          - { url: https://kubernetes.default.svc, env: us }
  template:
    metadata:
      name: "checkout-{{env}}"
      labels: { env: "{{env}}" }
    spec:
      project: default
      source:
        repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
        targetRevision: main
        path: apps/checkout/overlays/{{env}}
      destination:
        server: "{{url}}"
        namespace: shop
      syncPolicy:
        automated: { prune: true, selfHeal: true }
        syncOptions: ["CreateNamespace=true"]
```

### file: apps/checkout/overlays/canary/kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: ["../../base"]
```

### file: apps/checkout/base/deployment.yaml

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

## Expected Failure

Template (or base image) set to `nginx:broken`; ApplicationSet
reconciles:

```bash
kubectl -n argocd get applications.argoproj.io
# checkout-canary  Degraded
# checkout-eu      Degraded
# checkout-us      Degraded
```

All three moved in one interval. A generator glob typo with
`applicationsSync: sync` may **delete** apps that dropped out of the
list — second blast radius.

## Expected Outcome

```bash
kubectl -n argocd get applicationset checkout -o yaml | grep -A12 strategy
# type: RollingSync
# steps: canary, then eu+us
```

After a bad image commit: `checkout-canary` Degraded; `checkout-eu`
still the previous image until canary is Healthy.

## Hints

### Hint 1 — `applicationsSync: sync` means create, update, and delete

`create-only` never updates children. `create-update` updates but will
not delete apps that leave the generator. `sync` deletes them. A bad
glob plus `sync` is an org-wide undeploy.

### Hint 2 — RollingSync is label steps, not hope

Child Applications need `template.metadata.labels` that the steps
match. Without labels, every app matches every step. `maxUpdate` caps
how many apps in a step move at once.

## Solution

```yaml
spec:
  syncPolicy: { applicationsSync: create-update }
  strategy:
    type: RollingSync
    rollingSync:
      steps:
        - matchExpressions: [{ key: env, operator: In, values: [canary] }]
        - matchExpressions: [{ key: env, operator: In, values: [eu, us] }]
          maxUpdate: 1
```

Fix the image in git first so canary becomes Healthy; EU/US then roll.
Review ApplicationSet diffs like Terraform that loops regions. Revert
in git — do not `kubectl set image` on every cluster.
