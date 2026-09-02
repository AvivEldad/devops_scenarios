# The PVC that will not bind

## Briefing

A StatefulSet (or a pod with a PersistentVolumeClaim) is stuck `Pending`. The PVC is also
`Pending`, status `WaitingForFirstConsumer` or no volume available at all. No storage is
being provisioned.

Either there is no StorageClass to dynamically provision from, the requested class name
does not exist, or the access mode you asked for is impossible on this cluster. The claim
cannot bind, so the pod cannot start.

## Your Task

- Apply the PVC and pod and observe both stay `Pending`.
- Determine why the claim cannot bind (missing class, wrong name, or unsupported access
  mode).
- Fix it so the volume provisions and the pod runs.

## Starter Files

### file: app.yaml

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
  namespace: default
spec:
  accessModes: ["ReadWriteMany"]     # RWX often unsupported by default provisioners
  storageClassName: fast-ssd         # a class that does not exist on this cluster
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: writer
  namespace: default
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sh", "-c", "echo hi > /data/f; sleep 3600"]
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: data
```

## Expected Failure

```bash
kubectl apply -f app.yaml
kubectl get pvc data
# NAME   STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE
# data   Pending                                      fast-ssd       30s

kubectl describe pvc data | tail -3
# storageclass.storage.k8s.io "fast-ssd" not found
```

```bash
kubectl get pod writer
# writer   0/1   Pending   0   30s   (waiting for the PVC to bind)
```

The PVC names a StorageClass that does not exist, so nothing provisions a volume. The pod
waits on the PVC, which waits on a class that is not there.

## Expected Outcome

The PVC binds and the pod runs.

A valid StorageClass is used (list what the cluster actually has):

```bash
kubectl get storageclass
# standard (default)   ...
```

The PVC binds:

```bash
kubectl get pvc data
# data   Bound   pvc-....   1Gi   RWO   standard   1m
```

The pod runs and can write:

```bash
kubectl get pod writer          # Running
kubectl exec writer -- cat /data/f
# hi
```

## Hints

### Hint 1 — Read the PVC events and list the classes

```bash
kubectl describe pvc data | tail
kubectl get storageclass
```

`"<name>" not found` means the class does not exist — use one that does, or omit
`storageClassName` to get the cluster default. `WaitingForFirstConsumer` is normal for
`volumeBindingMode: WaitForFirstConsumer`; the volume binds only once a pod is scheduled.

### Hint 2 — Match the access mode to what the provisioner supports

`ReadWriteMany` (RWX) needs a shared filesystem provisioner (NFS, CephFS, EFS). Most default
block provisioners only support `ReadWriteOnce` (RWO). If you asked for RWX and got nothing,
switch to RWO unless you truly need multi-node mounting.

## Solution

The PVC named a nonexistent StorageClass and asked for an access mode the cluster does not
provide. Use an existing class and a supported access mode.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
  namespace: default
spec:
  accessModes: ["ReadWriteOnce"]     # supported by default block provisioners
  storageClassName: standard         # a class that exists (see: kubectl get sc)
  resources:
    requests:
      storage: 1Gi
```

```bash
kubectl apply -f app.yaml
kubectl get pvc data          # Bound
kubectl get pod writer        # Running
```

- **A `Pending` PVC is a provisioning problem** — read `describe pvc`. The two usual causes
  are a StorageClass name that does not exist and an access mode the provisioner cannot
  satisfy.
- **`kubectl get storageclass` first.** Use a class that exists, or omit `storageClassName`
  to take the cluster default (the one marked `(default)`).
- **RWO vs RWX matters.** `ReadWriteOnce` = one node at a time (most block storage);
  `ReadWriteMany` = many nodes at once (needs a shared-filesystem provisioner). Asking for RWX
  on RWO-only storage silently never binds.
- **`WaitForFirstConsumer` is not a bug.** With that binding mode the PVC intentionally stays
  `Pending` until a pod that uses it is scheduled, so the volume lands in the right zone —
  the pod scheduling is what unblocks it.
- **StatefulSet PVCs are templated and sticky.** Each replica keeps its own PVC across
  restarts; deleting the StatefulSet does not delete the PVCs, so clean them up explicitly
  when you mean to.
