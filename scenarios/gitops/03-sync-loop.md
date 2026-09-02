# The application that redeploys every three minutes

## Briefing

`checkout` has synced 4,812 times in the last ten days. The Argo CD UI shows it
flipping between `Synced` and `OutOfSync` continuously. Pods restart several times an
hour, which users experience as intermittent dropped sessions.

Nobody has changed the repository in a week.

Three independent things are causing perpetual reconciliation, and they interact: two
controllers are overwriting each other's work, a mutable image tag makes "the same
commit" mean different things over time, and a field the API server sets by itself is
being read as drift.

This is the failure mode that makes teams distrust GitOps, and it is entirely
diagnosable.

> Requires a cluster with Argo CD and metrics-server (for the HPA to function).
> `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml`

## Your Task

1. Deploy the application and confirm the sync loop, with evidence — not just the
   impression that it looks busy.
2. Identify all three causes. For each, name which two parties disagree about which
   field.
3. Fix them so the application stays `Synced` with no sync activity while the
   repository is unchanged.
4. Confirm that autoscaling still works and that a genuine git change still deploys.

Turning off `selfHeal` is not the fix. That disables the mechanism rather than
correcting the disagreement.

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
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
    spec:
      containers:
        - name: api
          image: nginx:latest
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: http
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
```

### file: manifests/hpa.yaml

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: checkout
  namespace: shop
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: checkout
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
```

### file: manifests/service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: checkout
  namespace: shop
spec:
  type: ClusterIP
  clusterIP: ""
  selector:
    app: checkout
  ports:
    - name: http
      port: 80
      targetPort: http
      nodePort: null
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
    server: https://kubernetes.default.svc
    namespace: shop

  syncPolicy:
    automated:
      selfHeal: true
      prune: true
    syncOptions:
      - CreateNamespace=true
```

## Expected Failure

Deploy it and watch:

```bash
kubectl apply -f application.yaml
watch -n5 'kubectl -n argocd get application checkout \
  -o jsonpath="{.status.sync.status} {.status.health.status}"; echo'
```

```
Synced Healthy
OutOfSync Progressing
Synced Progressing
OutOfSync Healthy
...
```

Get the evidence rather than the impression:

```bash
argocd app history checkout | tail -5
# revision unchanged, but the sync count keeps climbing

kubectl -n shop get pods
# AGE column resets constantly; RESTARTS climbing on nothing
```

Ask Argo what it thinks is wrong:

```bash
argocd app diff checkout
```

```
===== apps/Deployment shop/checkout ======
<   replicas: 4          # live  (set by the HPA)
>   replicas: 2          # desired (git)

===== /Service shop/checkout ======
<   clusterIP: 10.96.14.22    # live (assigned by the API server)
>   clusterIP: ""             # desired (git)
```

And the third cause, which the diff cannot show you: `nginx:latest` with
`imagePullPolicy: Always` means every new pod may pull a different image than its
siblings, so "the same commit" does not describe a fixed deployment at all.

## Expected Outcome

The application must be quiet when the repository is quiet.

Observe for ten minutes with no git changes. The revision and sync count must not
move:

```bash
argocd app get checkout -o json | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status']['sync']['status'], d['status']['sync']['revision'][:7])"
sleep 600
# same output, same revision
```

Status is stable:

```bash
kubectl -n argocd get application checkout \
  -o jsonpath='{.status.sync.status}{" "}{.status.health.status}{"\n"}'
# Synced Healthy
```

The diff is empty:

```bash
argocd app diff checkout; echo "exit=$?"
# no output, exit=0
```

Pods are not being recreated. Check that ages keep increasing:

```bash
kubectl -n shop get pods
sleep 300
kubectl -n shop get pods
# AGE increased by ~5m; RESTARTS unchanged
```

**Autoscaling still works.** Generate load and confirm the HPA scales up, and that
Argo does not revert it:

```bash
kubectl -n shop run load --rm -it --image=busybox:1.36 --restart=Never -- \
  sh -c 'while true; do wget -q -O- http://checkout >/dev/null; done'
# in another shell:
kubectl -n shop get hpa checkout -w
# REPLICAS climbs above 2

kubectl -n argocd get application checkout -o jsonpath='{.status.sync.status}{"\n"}'
# Synced        <- must NOT go OutOfSync because of the scale-up
```

**Real changes still deploy.** Commit an actual change and confirm it syncs:

```bash
# change the readiness probe period, commit, push
argocd app sync checkout
argocd app history checkout
# a new revision appears
```

**The image is deterministic.** The deployed image must be a fixed reference:

```bash
kubectl -n shop get deploy checkout -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
# nginx:1.27.2-alpine  or  nginx@sha256:...
# must NOT be :latest
```

## Hints

### Hint 1 — Every sync loop is two writers and one field

Reconciliation loops always reduce to the same shape: two controllers each believe
they own a field, and each writes its own value. Argo writes git's value, the other
controller writes its own, three minutes later Argo notices and writes again.

Your job is to enumerate the disagreements. `argocd app diff` names two of them
directly. For each, ask: **who else writes this field, and should git own it at all?**

### Hint 2 — The HPA and git both own `replicas`

The HPA exists to change `spec.replicas`. Git declares `replicas: 2`. Both are
authoritative and they cannot both win.

The resolution is that git must stop declaring the field:

- remove `replicas` from the Deployment manifest entirely, and
- tell Argo to ignore differences on that path

```yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      name: checkout
      jsonPointers:
        - /spec/replicas
```

Note that removing the field alone is not sufficient: Argo would then see the live
value as an addition. Both halves are required.

### Hint 3 — Some fields are filled in by the API server

`clusterIP: ""` in the manifest is not "no cluster IP" — it is an empty string that
the API server replaces with an allocated address. Argo then compares its empty
string against the real IP and reports drift forever.

`nodePort: null` behaves similarly for `NodePort` services.

These are **server-populated fields**, and the fix is to not specify them. Delete the
lines. The general principle: only declare fields you intend to control. Copying a
`kubectl get -o yaml` dump into your repository is how these end up there, because
that output contains everything the server added.

### Hint 4 — Mutable tags break the meaning of a commit

`image: nginx:latest` with `imagePullPolicy: Always` means the identity of what runs
is decided at pod-creation time, not at commit time. Two pods in the same
ReplicaSet can be running different code, and rolling back the repository does not
roll back the deployment.

Pin to an immutable reference:

```yaml
image: nginx:1.27.2-alpine
# or, strongest:
image: nginx@sha256:...
```

For automated image updates, the correct pattern is a tool that writes the new tag
**back into git** — Argo CD Image Updater in git write-back mode, or a CI step that
commits the digest — so the repository remains the source of truth.

### Hint 5 — Diagnose with the right command for each cause

```bash
# what does Argo think differs?
argocd app diff checkout

# who else is writing this field? (server-side apply tracks field ownership)
kubectl -n shop get deploy checkout --show-managed-fields -o yaml | grep -A5 manager

# is the loop still happening?
kubectl -n argocd logs deploy/argocd-application-controller --tail=100 | grep checkout
```

`--show-managed-fields` is the direct answer to "who owns this field". You will see
`argocd-controller` and `kube-controller-manager` both listed as managers of
`spec.replicas`, which is the disagreement made visible.

## Solution

Three writers-versus-git conflicts.

**Fault 1 — the HPA and git both set `replicas`.** Remove the field from the manifest
and add an ignore rule.

**Fault 2 — `clusterIP: ""` and `nodePort: null` are server-populated.** Remove them.

**Fault 3 — `nginx:latest` is mutable.** Pin it.

### The corrected `deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: shop
spec:
  # replicas intentionally omitted: owned by the HorizontalPodAutoscaler
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
    spec:
      containers:
        - name: api
          image: nginx:1.27.2-alpine
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: http
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 128Mi
```

### The corrected `service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: checkout
  namespace: shop
spec:
  type: ClusterIP
  selector:
    app: checkout
  ports:
    - name: http
      port: 80
      targetPort: http
```

### The corrected `application.yaml`

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
    server: https://kubernetes.default.svc
    namespace: shop

  syncPolicy:
    automated:
      selfHeal: true
      prune: true
    syncOptions:
      - CreateNamespace=true
      - ApplyOutOfSyncOnly=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m

  ignoreDifferences:
    - group: apps
      kind: Deployment
      name: checkout
      jsonPointers:
        - /spec/replicas
```

Verify the loop has stopped:

```bash
argocd app sync checkout
argocd app diff checkout && echo "no diff"
sleep 600
argocd app get checkout | grep -E 'Sync Status|Health Status'
```

The concepts that make this class of problem tractable:

- **Field ownership is the whole question.** For any field, exactly one system should
  be authoritative. When two are, you get a loop. Kubernetes exposes ownership through
  server-side apply's `managedFields`, which turns the question into something you can
  query rather than reason about.
- **`ignoreDifferences` is a contract, not a workaround.** It states "git does not own
  this field". Used correctly it is precise and documented. Used to silence a diff you
  have not understood, it hides real drift — so always pair it with removing the field
  from the manifest.
- **Immutable image references make commits meaningful.** A digest pin means the
  commit fully determines what runs, which is what makes rollback and audit work at
  all. `:latest` in a GitOps repo quietly removes both.
- **`ApplyOutOfSyncOnly=true`** limits each sync to resources that actually differ,
  reducing churn on large applications.
- **The retry block with backoff** stops a transiently failing sync from hammering the
  API server, which matters once you have many applications.

One caution on `ignoreDifferences`: it applies to the *diff*, not to the apply. If git
still contains the field, Argo will still send it on every sync — it just will not
report the difference. That is why both changes are needed, and why a scenario like
this often looks fixed for three minutes and then resumes.

## What You Learned

Nobody had changed anything, and the system was in constant motion. The cause was not
a bug in Argo, the HPA, or Kubernetes — each was correctly enforcing the state it had
been told to enforce, and nobody had decided which of them was in charge.

That decision is a design responsibility that GitOps makes unavoidable and does not
make for you. Before adding any resource to a GitOps repository, the question to ask
is which fields another controller will write, and to deliberately cede those. When a
sync loop appears, resist the urge to disable self-healing: run the diff, identify the
two writers, and settle the ownership. The loop is the system telling you about an
ambiguity you left in your configuration.
