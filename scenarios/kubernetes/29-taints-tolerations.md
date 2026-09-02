# The taints and tolerations that left pods homeless

## Briefing

After adding a dedicated GPU node pool (or a "spot" pool), some pods will not schedule at
all (`Pending`, no nodes match), while other pods that should stay off the special nodes
landed on them anyway. Node selection is not behaving as intended.

Taints repel pods that lack a matching toleration; tolerations let pods onto tainted nodes
but do not *attract* them. The GPU pool is tainted so normal pods avoid it, but the GPU
workload lacks the toleration (so it is homeless), and a non-GPU pod has a stray toleration
plus no anti-affinity, so it drifts onto the expensive nodes.

## Your Task

- Reproduce a GPU/dedicated pool where the right pod cannot land and the wrong pod does.
- Explain the difference between taints/tolerations (repel/permit) and affinity (attract).
- Fix scheduling so the special workload runs on the special nodes and nothing else does.

## Starter Files

### file: setup.md

```text
The GPU nodes are tainted so ordinary pods stay away:
  kubectl taint nodes gpu-node-1 dedicated=gpu:NoSchedule
  kubectl label nodes gpu-node-1 accelerator=nvidia

Goal:
  - the 'trainer' pod (needs GPU) MUST run on gpu-node-1
  - ordinary pods MUST NOT run on gpu-node-1
```

### file: workloads.yaml

```yaml
# Needs the GPU node, but has NO toleration -> repelled by the taint -> Pending
apiVersion: v1
kind: Pod
metadata: { name: trainer, namespace: default }
spec:
  containers:
    - name: trainer
      image: busybox:1.36
      command: ["sh", "-c", "echo training; sleep 3600"]
  # no tolerations, no nodeAffinity for accelerator=nvidia
---
# Ordinary pod that accidentally tolerates the GPU taint -> may land on the pricey node
apiVersion: v1
kind: Pod
metadata: { name: batch, namespace: default }
spec:
  tolerations:
    - key: dedicated
      operator: Equal
      value: gpu
      effect: NoSchedule          # tolerates GPU taint, but has no reason to be there
  containers:
    - name: batch
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
```

## Expected Failure

```bash
kubectl apply -f workloads.yaml
kubectl get pods -o wide
# trainer   0/1   Pending   ...              <- cannot tolerate the GPU taint
# batch     1/1   Running   gpu-node-1        <- drifted onto the GPU node it should avoid

kubectl describe pod trainer | tail -3
# 0/3 nodes are available: 1 node(s) had untolerated taint {dedicated: gpu}, ...
```

The GPU node's taint repels the `trainer` (it has no toleration), so it stays Pending. The
`batch` pod *does* tolerate the taint and has nothing steering it elsewhere, so the scheduler
is free to place it on the GPU node. Tolerations permit; they do not attract — and permitting
the wrong pod is a cost and contention problem.

## Expected Outcome

The GPU workload runs on GPU nodes; everything else stays off them.

The trainer tolerates the taint *and* is attracted to GPU nodes by affinity:

```bash
kubectl get pod trainer -o wide
# trainer   1/1   Running   gpu-node-1
```

Ordinary pods do not schedule onto the GPU node:

```bash
kubectl get pods -o wide | grep gpu-node-1
# only the trainer (and DaemonSets) run there
```

The trainer's placement is intentional, not luck:

```bash
kubectl get pod trainer -o jsonpath='{.spec.tolerations}{"\n"}'    # tolerates dedicated=gpu
kubectl get pod trainer -o jsonpath='{.spec.affinity}{"\n"}'       # requires accelerator=nvidia
```

## Hints

### Hint 1 — Toleration ≠ attraction

A taint (`NoSchedule`) repels pods without a matching toleration. A toleration only *permits*
a pod onto the tainted node — it does not pull the pod there. To *require* GPU nodes, add a
`nodeAffinity` (or `nodeSelector`) matching a node label like `accelerator=nvidia`. You need
both: toleration to be allowed on, affinity to be placed on.

### Hint 2 — Keep other pods off by not tolerating

Ordinary pods stay off tainted nodes simply by *not* having the toleration — do not add it
"just in case". The `batch` pod's stray toleration is the bug; remove it. Use taints to
reserve pools, node labels + affinity to target them, and keep tolerations minimal and
intentional.

## Solution

Give the GPU workload both a toleration and a matching node affinity; remove the stray
toleration from the ordinary pod.

```yaml
apiVersion: v1
kind: Pod
metadata: { name: trainer, namespace: default }
spec:
  tolerations:
    - key: dedicated
      operator: Equal
      value: gpu
      effect: NoSchedule            # allowed onto the tainted GPU node
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: accelerator     # attracted TO the GPU node
                operator: In
                values: ["nvidia"]
  containers:
    - name: trainer
      image: busybox:1.36
      command: ["sh", "-c", "echo training; sleep 3600"]
---
apiVersion: v1
kind: Pod
metadata: { name: batch, namespace: default }
spec:
  # no toleration -> the GPU taint keeps this ordinary pod off the GPU node
  containers:
    - name: batch
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
```

```bash
kubectl apply -f workloads.yaml
kubectl get pods -o wide      # trainer on gpu-node-1, batch elsewhere
```

- **Taints repel; tolerations permit; affinity attracts.** These are three separate
  mechanisms. Reserving a node pool needs a taint (keep others out), a toleration (let the
  right pod in), and affinity/nodeSelector (steer the right pod there). Missing any one gives
  the wrong result.
- **A toleration does not place a pod** — it only removes the taint's objection. Without
  affinity, a tolerating pod can go anywhere, including back onto general nodes. That is why
  `trainer` needs both.
- **Keep pools exclusive by withholding tolerations.** Ordinary pods avoid a tainted pool
  automatically as long as they do not carry its toleration. A stray toleration is how
  expensive nodes fill with the wrong work.
- **Taint effects differ**: `NoSchedule` blocks new pods, `PreferNoSchedule` is a soft
  version, `NoExecute` also evicts already-running pods that do not tolerate it. Choose per how
  strict the reservation must be.
- **DaemonSets get broad tolerations on purpose** so agents run everywhere; that is expected
  and separate from workload scheduling.
- **`nodeSelector` is the simple form of node affinity** — fine for a single required label;
  use `nodeAffinity` for expressions, preferences, and multiple values.
