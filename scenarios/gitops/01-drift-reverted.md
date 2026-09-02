# The fix that keeps undoing itself

## Briefing

During an incident last night you scaled `orders-api` from 2 replicas to 6 with
`kubectl scale`. Traffic recovered. You went to bed.

By morning it was back to 2 replicas and the incident had resumed. Someone scaled it
up again. Four minutes later it was 2 again.

The team's working theory is that "something is fighting us" — a rogue HPA, a stuck
controller, a colleague with a script. It is none of those. It is Argo CD doing
precisely what it was installed to do, and the fact that the team finds this
surprising is the actual problem.

> You need a cluster and Argo CD installed:
> `kubectl create namespace argocd && kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml`
> You also need a git repository Argo can read. A local Gitea, a GitHub repo, or any
> URL Argo can reach will do.

## Your Task

Set up the application, reproduce the reversion, then make the change stick — the
right way.

1. Apply the Argo `Application` and confirm it syncs.
2. Scale the deployment with `kubectl` and watch the change disappear.
3. Explain precisely which component reverted it and why.
4. Make the replica count 6 in a way that survives, and verify Argo reports `Synced`
   and `Healthy` afterwards.
5. Then answer the harder question the scenario is really about: what should you have
   done at 02:00 during the incident?

## Starter Files

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
          resources:
            requests:
              cpu: 25m
              memory: 32Mi
```

### file: manifests/service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: shop
spec:
  selector:
    app: orders-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: orders-api
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

Push the manifests to your repository, point `application.yaml` at it, and apply:

```bash
kubectl apply -f application.yaml
kubectl -n argocd get application orders-api
# NAME         SYNC STATUS   HEALTH STATUS
# orders-api   Synced        Healthy
```

Now do what you did during the incident:

```bash
kubectl -n shop scale deployment orders-api --replicas=6
kubectl -n shop get deploy orders-api
# NAME         READY   UP-TO-DATE   AVAILABLE
# orders-api   6/6     6            6
```

Wait a few minutes, or watch it happen:

```bash
kubectl -n shop get deploy orders-api -w
```

```
orders-api   6/6   6   6
orders-api   2/6   2   2      <- Argo CD reverts it
orders-api   2/2   2   2
```

Check the Argo events and it tells you exactly what it did:

```bash
kubectl -n argocd describe application orders-api | tail -20
# ... Reason: ResourceUpdated  Message: Updated health status ...
argocd app history orders-api
```

The deployment was never broken. Your change was **deleted**, because Argo compares
the cluster against git every three minutes and, with `selfHeal: true`, corrects any
difference. Git says 2. Git wins.

## Expected Outcome

The replica count is 6, it stays 6, and Argo is content.

Git is the source of the change:

```bash
git log --oneline -1 -- manifests/deployment.yaml
# <sha> scale orders-api to 6 replicas for peak load

grep 'replicas:' manifests/deployment.yaml
#   replicas: 6
```

The cluster reflects it:

```bash
kubectl -n shop get deploy orders-api
# NAME         READY   UP-TO-DATE   AVAILABLE   AGE
# orders-api   6/6     6            6           20m
```

Argo reports clean status — this is the check that proves you did it the right way:

```bash
argocd app get orders-api
# Sync Status:    Synced to main (<sha>)
# Health Status:  Healthy
```

or without the CLI:

```bash
kubectl -n argocd get application orders-api \
  -o jsonpath='{.status.sync.status}{" "}{.status.health.status}{"\n"}'
# Synced Healthy
```

Wait five minutes and confirm it is still 6. This is the real test:

```bash
sleep 300
kubectl -n shop get deploy orders-api -o jsonpath='{.spec.replicas}{"\n"}'
# 6
```

The sync history records your change as a revision, giving you an audit trail and a
rollback path:

```bash
argocd app history orders-api
# ID  DATE  REVISION
# 0   ...   main (abc1234)
# 1   ...   main (def5678)
```

And you can undo it the same way you would undo any code change:

```bash
git revert <sha> && git push
# Argo syncs back to 2 replicas within the sync interval
```

## Hints

### Hint 1 — Read what `selfHeal` promises

```yaml
syncPolicy:
  automated:
    selfHeal: true
```

`selfHeal: true` instructs Argo CD to revert **any** difference between the cluster
and git, not just ones it caused. Argo polls the repository roughly every three
minutes and also reconciles on cluster events.

This is the entire value proposition of GitOps: the cluster cannot drift from the
declared state, because drift is automatically corrected. A `kubectl edit` is not a
change — it is a temporary deviation with a countdown timer.

### Hint 2 — Change the declared state, not the running state

The mental shift is that `kubectl apply`, `kubectl edit` and `kubectl scale` stop
being the tools you use to change things. They become read-only debugging tools.

The deploy process becomes:

```bash
# edit manifests/deployment.yaml -> replicas: 6
git commit -am "scale orders-api to 6 replicas for peak load"
git push
argocd app sync orders-api      # or just wait for the poll
```

Your change is now reviewable, attributable, revertible, and identical across every
environment that tracks this repo.

### Hint 3 — Watch the diff rather than guessing

Argo will show you precisely what it thinks is wrong:

```bash
argocd app diff orders-api
```

```
===== apps/Deployment shop/orders-api ======
6c6
<   replicas: 6        # live
---
>   replicas: 2        # desired (git)
```

`OutOfSync` always means "live differs from git", and the diff names the field. Get
into the habit of running this before touching anything.

### Hint 4 — Sometimes git should not own the field

Consider the case where a HorizontalPodAutoscaler manages `replicas`. Then git
declaring `replicas: 2` and the HPA setting `replicas: 9` will fight each other
forever, flapping every three minutes.

The fix is to stop declaring the field and tell Argo to ignore it:

```yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas
```

and remove `replicas` from the manifest entirely so nothing overwrites the autoscaler.
This is the correct answer whenever a controller legitimately owns a field.

### Hint 5 — What to do at 02:00

The honest answer is not "never touch the cluster". Emergencies happen and git
round-trips take time.

The options, roughly in order of preference:

- Commit the change. A one-line commit and push takes under a minute and is the
  fastest path that actually persists.
- If you must act immediately, disable auto-sync first so your change is not reverted
  while you are still firefighting, then reconcile git afterwards:
  `argocd app set orders-api --sync-policy none`
- Whatever you do, write it down. An out-of-band change that nobody records is how a
  cluster ends up in a state no repository describes.

## Solution

Nothing was broken. `selfHeal: true` was doing its job, and the operator was using
imperative commands against a declaratively managed system.

**The fix — change git:**

```bash
sed -i 's/^  replicas: 2$/  replicas: 6/' manifests/deployment.yaml
git commit -am "scale orders-api to 6 replicas for peak load"
git push

argocd app sync orders-api
argocd app get orders-api
```

**The better fix for a load-driven problem** is to let an autoscaler own the field, so
this incident cannot recur at all:

```yaml
# manifests/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: orders-api
  namespace: shop
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orders-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

Then remove `replicas` from the Deployment manifest and add the ignore rule to the
Application, or Argo and the HPA will overwrite each other every few minutes:

```yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas
```

The model to internalise:

```
git repository  =  desired state  (the only place you make changes)
       |
   Argo CD reconciliation loop  (every ~3 min, and on events)
       |
   cluster      =  actual state   (read-only for humans)
```

Argo's two status fields answer different questions, and confusing them wastes a lot
of time:

- **Sync status** — does the cluster match git? `Synced` or `OutOfSync`. Nothing to do
  with whether the application works.
- **Health status** — are the resources actually functioning? `Healthy`, `Degraded`,
  `Progressing`. Nothing to do with git.

An app can be `Synced` and `Degraded`, which means "you deployed exactly what you
asked for and it is broken" — a genuinely useful distinction that tells you to look at
your manifests rather than at the delivery pipeline.

Two more settings worth understanding while you are here:

- **`prune: false`**, as configured, means deleting a manifest from git does **not**
  delete the resource from the cluster. That is a safe default and also a trap: your
  repo stops being a complete description of the cluster. The intermediate GitOps
  scenario covers this.
- **`selfHeal: false`** with `automated` still syncs new git commits, but does not
  revert manual changes. Some teams start here while building trust, then enable
  self-heal once everyone has stopped using `kubectl edit`.

## What You Learned

The system was working correctly and the operator's model of it was wrong. That is a
different kind of bug from the ones in most of these scenarios, and it is extremely
common when a team adopts GitOps: the tooling silently changes what "making a change"
means, and the old reflexes keep producing surprising results.

The single sentence worth keeping: under GitOps, the cluster is an output, not an
input. `kubectl scale`, `kubectl edit` and `kubectl apply` become debugging tools that
happen to have side effects with a three-minute lifespan. If a change matters, it goes
in the repository — and the payoff is that every change to production is now a commit
with an author, a review, a timestamp and a revert button.
