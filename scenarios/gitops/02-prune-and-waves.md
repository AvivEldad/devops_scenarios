# Deleted from git, still running in production

## Briefing

Two problems arrived in the same week and the team has connected them incorrectly.

First: a `debug-proxy` Deployment that was removed from the repository three months
ago is still running in the cluster. It has an open NodePort, it has never been
patched, and it appeared in an audit finding. Argo reports the application as
`Synced`.

Second: every fresh installation of the same application into a new environment fails
on the first sync. The database migration Job runs before the database Secret exists,
crashes, and the whole sync is marked failed. Re-running it manually always works,
so the team re-runs it manually.

Both are configuration problems in the `Application`, and both are about Argo not
knowing something you never told it.

> Requires a cluster with Argo CD installed and a git repository Argo can read. See
> the beginner GitOps scenario for installation.

## Your Task

1. Reproduce the orphan: sync the app, delete a manifest from git, and confirm the
   resource survives while Argo still claims `Synced`.
2. Reproduce the ordering failure by syncing into a brand-new namespace.
3. Fix both, and make the repository an accurate and complete description of the
   cluster.
4. Prove that a deletion in git now removes the resource, and that a clean install
   succeeds on the first attempt.

Deleting the orphan by hand with `kubectl delete` is not the fix. It has to be
something the system does.

## Starter Files

### file: manifests/secret.yaml

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-db
  namespace: shop
type: Opaque
stringData:
  DATABASE_URL: "postgres://orders:notarealpassword@db.shop.svc:5432/orders"
```

### file: manifests/migrate-job.yaml

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: orders-migrate
  namespace: shop
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              echo "running migrations against $DATABASE_URL"
              test -n "$DATABASE_URL" || { echo "no database url"; exit 1; }
              echo "migrations complete"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: orders-db
                  key: DATABASE_URL
```

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      containers:
        - name: api
          image: nginx:1.27-alpine
          ports:
            - name: http
              containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: http
```

### file: manifests/debug-proxy.yaml

```yaml
# Added during an incident in March. Delete this file later in the exercise.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: debug-proxy
  namespace: shop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: debug-proxy
  template:
    metadata:
      labels:
        app: debug-proxy
    spec:
      containers:
        - name: proxy
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: orders
  namespace: argocd
spec:
  project: default

  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: manifests

  destination:
    server: https://kubernetes.default.svc
    namespace: shop

  syncPolicy:
    automated:
      selfHeal: true
      prune: false
    syncOptions:
      - CreateNamespace=true
```

## Expected Failure

### Problem 1: the orphan

Sync the application, then delete the debug proxy from git:

```bash
kubectl apply -f application.yaml
argocd app sync orders

git rm manifests/debug-proxy.yaml
git commit -m "remove debug proxy added during the March incident"
git push
argocd app sync orders
```

Argo is satisfied:

```bash
argocd app get orders
# Sync Status:  Synced to main (abc1234)
# Health Status: Healthy
```

And the resource is still there:

```bash
kubectl -n shop get deploy debug-proxy
# NAME          READY   UP-TO-DATE   AVAILABLE   AGE
# debug-proxy   1/1     1            1           94d
```

`Synced` does not mean "the cluster matches git". With pruning disabled it means
"everything in git exists in the cluster" — a one-way check. Anything that used to be
in git is invisible to it.

### Problem 2: the ordering failure

Install into a fresh namespace to simulate a new environment:

```bash
kubectl -n argocd patch application orders --type merge \
  -p '{"spec":{"destination":{"namespace":"shop-staging"}}}'
argocd app sync orders
```

```
Job/orders-migrate  SyncFailed
  Error: pods "orders-migrate-xxxxx" is forbidden: ... secret "orders-db" not found

Sync status: OutOfSync
Operation: Failed
```

Argo applies all resources in one pass, in its default ordering, and the Job's pod
starts before the Secret exists. Nothing declares that the migration depends on it.

## Expected Outcome

Deletion in git must delete in the cluster, and a clean install must succeed on the
first sync.

**Pruning works.** With `debug-proxy.yaml` removed from git:

```bash
argocd app sync orders
kubectl -n shop get deploy debug-proxy
# Error from server (NotFound): deployments.apps "debug-proxy" not found
```

Argo reports the pruned resource in its operation output:

```bash
argocd app get orders --show-operation | grep -i prune
# Deployment  shop  debug-proxy  Pruned
```

**Ordering works.** Delete the target namespace entirely and sync from nothing:

```bash
kubectl delete namespace shop-staging --ignore-not-found
argocd app sync orders
```

The sync must succeed on the **first** attempt, with the Secret applied before the
Job runs:

```bash
argocd app get orders
# Sync Status:  Synced
# Health Status: Healthy
# Operation:    Succeeded
```

The migration Job completed rather than erroring:

```bash
kubectl -n shop-staging get jobs
# NAME              STATUS     COMPLETIONS   AGE
# orders-migrate    Complete   1/1           1m

kubectl -n shop-staging logs job/orders-migrate
# running migrations against postgres://...
# migrations complete
```

**Repeat syncs are stable.** Sync twice more and confirm nothing fails, and no
duplicate Job is left in a failed state:

```bash
argocd app sync orders && argocd app sync orders
kubectl -n shop-staging get jobs
```

**Deletion protection still exists where it matters.** Confirm that a resource you
explicitly mark must survive pruning:

```bash
kubectl -n shop-staging get secret orders-db
# still present even if temporarily removed from the sync path
```

## Hints

### Hint 1 — `prune` controls deletion, and it is off

```yaml
syncPolicy:
  automated:
    prune: false
```

With `prune: false`, Argo will create and update but never delete. That is a safe
default for a first installation and a liability afterwards, because your repository
stops being a complete description of reality — exactly the property GitOps is
supposed to give you.

Turn it on, and understand what you are enabling: anything not in git gets deleted.

### Hint 2 — Find the orphans before you enable pruning

Do not enable pruning blind on a cluster with three months of accumulated state. Ask
Argo what it *would* delete:

```bash
argocd app sync orders --dry-run --prune
argocd app diff orders
```

Resources Argo manages but no longer finds in git are shown as pruning candidates.
Review that list with the team, because something on it may be load-bearing and
undocumented.

### Hint 3 — Protect what must never be pruned

Some resources should outlive a manifest being moved or renamed — a PersistentVolumeClaim
holding real data, for example. Annotate them:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-options: Prune=false
```

There is also `Delete=false`, which prevents removal even when the whole Application
is deleted. Use them sparingly and deliberately; every exception is a small hole in
the "git describes the cluster" guarantee.

### Hint 4 — Sync waves order the apply

Argo applies resources in phases. Within a phase it uses a sensible built-in ordering
(namespaces, then CRDs, then most things), but it has no idea that your Job needs your
Secret.

Sync waves are an explicit ordering annotation. Lower numbers apply first, and Argo
waits for each wave to become healthy before starting the next:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
```

Give the Secret a lower wave than the Job, and the Job a lower wave than the
Deployment that depends on the migration having run.

### Hint 5 — A migration is a hook, not a resource

A `Job` in the manifests directory is a problem on every re-sync: the Job object
already exists, is immutable in most fields, and either fails to apply or leaves
completed Jobs accumulating.

Argo has resource hooks for exactly this:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
```

`PreSync` runs the Job to completion before the main sync begins, and
`HookSucceeded` deletes it afterwards so the next sync starts clean. If the hook
fails, the sync stops — which is what you want from a migration.

## Solution

Two settings that were never configured: pruning, and any expression of dependency
order.

### Fix 1 — enable pruning, after auditing

```bash
argocd app sync orders --dry-run --prune    # review the list first
```

```yaml
syncPolicy:
  automated:
    selfHeal: true
    prune: true
  syncOptions:
    - CreateNamespace=true
    - PruneLast=true
```

`PruneLast=true` defers deletions until after everything else has applied
successfully, so a failed sync cannot leave you having deleted the old resources
without creating the new ones.

### Fix 2 — order the resources with waves, and make the migration a hook

The Secret goes first:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-db
  namespace: shop
  annotations:
    argocd.argoproj.io/sync-wave: "-2"
type: Opaque
stringData:
  DATABASE_URL: "postgres://orders:notarealpassword@db.shop.svc:5432/orders"
```

The migration becomes a PreSync hook that cleans up after itself:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: orders-migrate
  namespace: shop
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
    argocd.argoproj.io/sync-wave: "-1"
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              echo "running migrations against $DATABASE_URL"
              test -n "$DATABASE_URL" || { echo "no database url"; exit 1; }
              echo "migrations complete"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: orders-db
                  key: DATABASE_URL
```

The application comes last, by default wave `0`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: shop
  annotations:
    argocd.argoproj.io/sync-wave: "0"
```

And delete `manifests/debug-proxy.yaml` from the repository. With pruning enabled,
the next sync removes it from the cluster.

The ordering model in full:

```
wave -2   Secret, ConfigMap, ServiceAccount, RBAC
wave -1   PreSync hook: database migration (must complete)
wave  0   Deployment, Service          (default)
wave  1   Ingress, HPA, PodMonitor
          PostSync hook: smoke test
```

Argo waits for each wave to report healthy before starting the next, which is what
makes this a real dependency mechanism rather than just a sort order.

Three things worth knowing that this scenario touches:

- **`Synced` is not "identical to git".** Without pruning it means "everything git
  declares exists". Understanding the asymmetry is what makes the orphan explicable
  rather than mysterious.
- **Hooks have phases**: `PreSync`, `Sync`, `PostSync`, `SyncFail`. A smoke test as a
  `PostSync` hook and a rollback notification as `SyncFail` turn a deployment into
  something that verifies itself.
- **The Secret in git is the elephant in this scenario.** A plaintext credential in a
  repository is not acceptable, and it is the price of naive GitOps. The real answers
  are Sealed Secrets, the External Secrets Operator pointing at a vault, or SOPS with
  age encryption. Whichever you choose, the encrypted form is what lives in git.

## What You Learned

Both failures came from Argo faithfully doing what it was configured to do, and the
configuration expressing less than the team assumed. Pruning disabled meant deletions
were silently ignored; no waves meant "apply these in a sensible order" was never
actually stated.

The habit to build is treating the `Application` spec as part of the deployment
contract rather than boilerplate you copy between repos. Whether deletions propagate,
what order things apply in, what must never be pruned, and what runs before the sync
are all decisions — and if you have not made them explicitly, you have accepted
defaults that will surprise you during an audit or a disaster recovery test, which
are the two worst moments to discover that your repository does not describe your
cluster.
