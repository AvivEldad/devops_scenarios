# The Helm pre-install Job that never runs on the upgrade

## Briefing

Checkout migrations live in a Helm `pre-install` hook Job. The first
install ran them. Every later chart bump skips the Job. Schema never
migrates. Argo reports Synced because Helm `pre-install` is install-only.

Helm hooks and Argo hooks are different machines. `helm.sh/hook:
pre-install` does not mean Argo `PreSync`. On upgrade you need
`pre-upgrade` as well, or use `argocd.argoproj.io/hook: PreSync`.

## Your Task

- Install the chart-backed Application once; confirm the Job ran.
- Bump a value and sync again; show the Job does not run.
- Change the hook so migrations run on every sync (and clean up).
- Second sync must run migrate without leaving a stuck Job.

## Starter Files

### file: charts/checkout/templates/migrate-job.yaml

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: checkout-migrate
  annotations:
    "helm.sh/hook": pre-install
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: busybox:1.36
          command: ["sh", "-c", "echo migrate {{ .Values.schema }} && true"]
```

### file: charts/checkout/values.yaml

```yaml
schema: v1
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
    path: charts/checkout
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

First sync: Job runs. Change `schema: v2`, push, sync:

```bash
argocd app sync checkout
kubectl -n shop get jobs
# checkout-migrate   1/1   45m    <- still the install Job
kubectl -n shop logs job/checkout-migrate
# migrate v1
```

No `migrate v2` line. Health Synced. Schema is not.

## Expected Outcome

Each sync runs migrate for the current values, then deletes the Job.

```bash
argocd app sync checkout
kubectl -n shop logs job/checkout-migrate
# migrate v2
argocd app get checkout
# Operation: Succeeded
```

A third sync does not fail on an immutable Job spec.

## Hints

### Hint 1 — Helm hook phases are install vs upgrade

`pre-install` runs only when Helm considers it a new release.
`pre-upgrade` runs on later syncs. `pre-install,pre-upgrade` is the
usual Helm-native pair. Argo maps Helm hooks; it does not invent
`pre-upgrade` for you.

### Hint 2 — Argo PreSync is the GitOps-native hook

`argocd.argoproj.io/hook: PreSync` plus `hook-delete-policy:
HookSucceeded` runs before every sync, waits for the Job, and can
delete it. Mixing Helm and Argo hook annotations on one Job is how it
"always runs" *and* "never runs".

## Solution

Prefer Argo hooks for something that must run every deploy:

```yaml
metadata:
  name: checkout-migrate
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
```

Or stay in Helm: `"helm.sh/hook": pre-install,pre-upgrade`.

- This is **not** the prune/waves Job-before-Secret drill. Here the Job
  is a hook that silently skipped.
- **`hook-delete-policy`** matters: without it, Job spec immutability
  fails the next sync even when the hook *does* fire.
