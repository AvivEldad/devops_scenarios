# The StatefulSet that lost its data on restart

## Briefing

A database runs as a StatefulSet. After a rolling restart, one replica comes back empty —
its data is gone — or two replicas fight over the same volume and corrupt it. Ordinal
identity and stable storage are not behaving as expected.

The workload was written like a Deployment: a shared PVC instead of `volumeClaimTemplates`,
so replicas share (and clobber) one volume; or the pod management/update strategy loses the
per-replica identity that StatefulSets exist to provide.

## Your Task

- Deploy the broken stateful workload and reproduce data loss or volume contention on
  restart.
- Explain how StatefulSets provide stable identity and per-replica storage, and what breaks
  when you share a PVC.
- Fix it with `volumeClaimTemplates` so each replica keeps its own durable volume.

## Starter Files

### file: broken-sts.yaml

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-data          # ONE PVC shared by all replicas - wrong for StatefulSet
  namespace: default
spec:
  accessModes: ["ReadWriteOnce"]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
  namespace: default
spec:
  serviceName: db
  replicas: 3
  selector: { matchLabels: { app: db } }
  template:
    metadata: { labels: { app: db } }
    spec:
      containers:
        - name: db
          image: busybox:1.36
          command: ["sh", "-c", "echo $(hostname) >> /data/log; sleep 3600"]
          volumeMounts:
            - { name: data, mountPath: /data }
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: shared-data      # all pods mount the SAME claim
```

## Expected Failure

```bash
kubectl apply -f broken-sts.yaml
kubectl get pods -l app=db
# db-0   1/1   Running            ...
# db-1   0/1   ContainerCreating  ...   <- RWO PVC already attached to db-0's node
# db-2   0/1   Pending            ...

kubectl describe pod db-1 | tail -3
# Multi-Attach error for volume "pvc-...": Volume is already used by pod(s) db-0
```

A single `ReadWriteOnce` PVC can attach to one node at a time, so only one replica gets it;
the others cannot start (Multi-Attach error). If they could, they would all write to the
same volume and corrupt each other. This is exactly what `volumeClaimTemplates` prevents.

## Expected Outcome

Each replica has its own stable, durable volume that survives restarts.

Every replica gets its own PVC via the template:

```bash
kubectl get pvc -l app=db
# data-db-0   Bound   ...
# data-db-1   Bound   ...
# data-db-2   Bound   ...
```

Data persists across a restart, per replica:

```bash
kubectl exec db-0 -- cat /data/log     # contains db-0's history
kubectl delete pod db-0                # it comes back as db-0, reattached to data-db-0
kubectl exec db-0 -- cat /data/log     # history still there
```

All replicas run with stable identities:

```bash
kubectl get pods -l app=db
# db-0, db-1, db-2 all Running
```

## Hints

### Hint 1 — StatefulSets use volumeClaimTemplates, not a shared PVC

A StatefulSet gives each ordinal (`db-0`, `db-1`, ...) a stable name, stable network
identity (via the headless `serviceName`), and — through `volumeClaimTemplates` — its own
PVC named `data-db-0`, `data-db-1`, etc. Sharing one PVC defeats all of this and triggers
Multi-Attach on RWO storage.

### Hint 2 — Identity and storage are sticky by design

When `db-0` is deleted, it is recreated as `db-0` and reattached to `data-db-0` — that is the
whole point. Deleting the StatefulSet does *not* delete the PVCs (data is preserved
deliberately); clean them up explicitly when you truly want the data gone.

## Solution

Replace the shared PVC with `volumeClaimTemplates` so each replica provisions and keeps its
own volume.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
  namespace: default
spec:
  serviceName: db                 # headless Service for stable network identity
  replicas: 3
  selector: { matchLabels: { app: db } }
  template:
    metadata: { labels: { app: db } }
    spec:
      containers:
        - name: db
          image: busybox:1.36
          command: ["sh", "-c", "echo $(hostname) >> /data/log; sleep 3600"]
          volumeMounts:
            - { name: data, mountPath: /data }
  volumeClaimTemplates:           # one PVC per replica: data-db-0, data-db-1, ...
    - metadata: { name: data }
      spec:
        accessModes: ["ReadWriteOnce"]
        resources: { requests: { storage: 1Gi } }
```

```bash
kubectl delete -f broken-sts.yaml           # remove the shared-PVC version
kubectl apply -f good-sts.yaml
kubectl get pvc -l app=db                    # data-db-0/1/2 each Bound
```

- **`volumeClaimTemplates` give each replica its own PVC.** That per-ordinal storage
  (`data-db-0`, ...) is the reason StatefulSets exist; a shared PVC breaks it and, on RWO
  storage, causes Multi-Attach errors.
- **Identity is stable and sticky.** `db-0` always comes back as `db-0` on the same volume,
  with a stable DNS name via the headless `serviceName`. Ordered, predictable identity is what
  stateful systems (databases, quorums) depend on.
- **PVCs outlive the StatefulSet on purpose.** Deleting the StatefulSet keeps the PVCs so you
  do not lose data by accident; delete them explicitly (or via `persistentVolumeClaimRetentionPolicy`)
  when you really mean to.
- **RWO volumes attach to one node at a time.** Two pods sharing one RWO PVC is a Multi-Attach
  error, not scaling — each replica needs its own claim.
- **`podManagementPolicy` and update strategy matter.** Ordered rollout (default) restarts one
  ordinal at a time, preserving quorum; `Parallel` is faster but unsafe for many stateful
  systems. Choose deliberately.
