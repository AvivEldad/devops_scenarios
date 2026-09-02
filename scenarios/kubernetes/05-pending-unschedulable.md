# The pod stuck in Pending with nowhere to go

## Briefing

A pod has been `Pending` for ten minutes. It is not pulling an image or crashing — it has
not been placed on a node at all. The cluster has nodes, and they look healthy.

The scheduler cannot find a node that satisfies the pod's requirements: it asks for more
memory than any node has free. A second variant of the same problem is a node selector
that matches nothing.

## Your Task

- Apply the pod and confirm it stays Pending.
- Read the scheduler's explanation in the events.
- Make it schedulable without simply removing all constraints.

## Starter Files

### file: pod.yaml

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: heavy
  namespace: default
spec:
  containers:
    - name: app
      image: nginx:1.27-alpine
      resources:
        requests:
          memory: "64Gi"      # more than any node has
          cpu: "32"
  nodeSelector:
    disktype: nvme            # no node has this label
```

## Expected Failure

```bash
kubectl apply -f pod.yaml
kubectl get pod heavy
# NAME    READY   STATUS    RESTARTS   AGE
# heavy   0/1     Pending   0          3m
```

```bash
kubectl describe pod heavy | tail -8
# Warning  FailedScheduling  0/3 nodes are available:
#   3 Insufficient memory, 3 Insufficient cpu,
#   3 node(s) didn't match Pod's node affinity/selector.
```

The scheduler lists exactly why each node was rejected: not enough memory, not enough CPU,
and no node with `disktype: nvme`.

## Expected Outcome

The pod is scheduled and runs.

```bash
kubectl get pod heavy
# heavy   1/1   Running   0   30s
```

Requests fit within a node's allocatable capacity:

```bash
kubectl describe node | grep -A5 Allocatable | grep -E 'cpu|memory'
# the pod's requests are below these
```

The node selector matches a real node label, or is removed if unnecessary:

```bash
kubectl get nodes --show-labels | grep disktype
# either a labelled node exists, or the selector is gone
```

## Hints

### Hint 1 — `FailedScheduling` events explain every rejection

```bash
kubectl describe pod <name>
```

The message enumerates why each node was unsuitable: `Insufficient memory/cpu`, `didn't
match node affinity/selector`, taints, etc. Pending almost always means the scheduler
could not satisfy a constraint — read which.

### Hint 2 — Right-size requests and match real labels

Set `requests` to what the pod actually needs and confirm it fits a node's `Allocatable`
(which is less than capacity — the kubelet and system reserve some). For the selector,
either label a node (`kubectl label node <n> disktype=nvme`) or drop the selector if the
requirement is not real.

## Solution

Impossible resource requests and a node selector matching nothing.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: heavy
  namespace: default
spec:
  containers:
    - name: app
      image: nginx:1.27-alpine
      resources:
        requests:
          memory: "128Mi"
          cpu: "100m"
        limits:
          memory: "256Mi"
```

```bash
kubectl apply -f pod.yaml
kubectl get pod heavy -w
```

- **`Pending` means unscheduled, and `FailedScheduling` events say why.** Insufficient
  resources, unmatched selectors/affinity, and taints are the usual causes; the message
  lists them per node.
- **`requests` must fit `Allocatable`, not capacity.** The node reserves memory and CPU for
  the kubelet and system daemons, so a request equal to total capacity will never schedule.
- **Requests drive scheduling; limits drive throttling and OOM.** Over-large requests waste
  capacity and cause Pending even when the app uses little — size them to real usage.
- **`nodeSelector`/affinity must match actual labels.** Label the node or drop the
  constraint. Check taints too (`kubectl describe node | grep Taints`) — a tainted node
  needs a matching toleration.
