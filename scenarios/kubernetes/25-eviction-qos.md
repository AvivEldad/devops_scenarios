# The eviction storm when the node ran out of memory

## Briefing

Under load, pods across a node suddenly go `Evicted` or are `OOMKilled`, including ones that
were behaving. The node reports `MemoryPressure`. Some evicted pods are your most important
ones; some memory hogs survived.

QoS class decides who dies first. Pods with no requests/limits (BestEffort) and pods over
their requests (Burstable) are evicted before Guaranteed pods — but a container that exceeds
its own memory limit is OOMKilled regardless. Missized requests/limits made the wrong pods
the victims.

## Your Task

- Reproduce node memory pressure and observe evictions/OOM kills.
- Explain how QoS class (Guaranteed / Burstable / BestEffort) determines eviction order.
- Size requests and limits so critical pods survive and hogs are contained.

## Starter Files

### file: workloads.yaml

```yaml
# BestEffort: no requests/limits -> first to be evicted under pressure
apiVersion: v1
kind: Pod
metadata: { name: besteffort, namespace: default, labels: { qos: besteffort } }
spec:
  containers:
    - name: c
      image: polinux/stress
      command: ["stress"]
      args: ["--vm", "1", "--vm-bytes", "256M", "--vm-hang", "0"]
      # no resources at all
---
# Critical app, but ALSO no requests -> also BestEffort, evicted just as easily
apiVersion: v1
kind: Pod
metadata: { name: critical, namespace: default, labels: { qos: should-be-guaranteed } }
spec:
  containers:
    - name: c
      image: nginx:1.27-alpine
      # no requests/limits -> unintentionally BestEffort
---
# Memory hog with a high limit -> survives while others are evicted
apiVersion: v1
kind: Pod
metadata: { name: hog, namespace: default, labels: { qos: burstable } }
spec:
  containers:
    - name: c
      image: polinux/stress
      command: ["stress"]
      args: ["--vm", "1", "--vm-bytes", "512M", "--vm-hang", "0"]
      resources:
        requests: { memory: "64Mi" }     # requests low, uses far more
        limits:   { memory: "1Gi" }
```

## Expected Failure

```bash
kubectl apply -f workloads.yaml
kubectl get pods
# besteffort   Evicted             ...
# critical     Evicted             ...   <- the important one died
# hog          Running             ...   <- the hog survived

kubectl describe node <node> | grep -A2 MemoryPressure
# MemoryPressure   True   kubelet has memory pressure

kubectl get events --field-selector reason=Evicted
# The node was low on resource: memory. Container c was using ...
```

The "critical" pod had no requests, making it BestEffort — first in line for eviction. The
hog, with a high limit and modest request, kept running. QoS, driven by how you set requests
and limits, chose the victims — and it chose wrong because the manifests were wrong.

## Expected Outcome

Critical pods survive pressure; hogs are contained.

The critical pod is Guaranteed (requests == limits) and is evicted last:

```bash
kubectl get pod critical -o jsonpath='{.status.qosClass}{"\n"}'
# Guaranteed
```

The hog is bounded so it is OOMKilled at its own limit instead of starving the node:

```bash
kubectl get pod hog -o jsonpath='{.status.qosClass}{"\n"}'
# Burstable   (with a realistic limit)
```

Under the same load, the critical pod stays Running:

```bash
kubectl get pods
# critical   Running   ...
```

## Hints

### Hint 1 — QoS class decides eviction order

- **Guaranteed**: every container has requests == limits for cpu and memory. Evicted last.
- **Burstable**: has some requests/limits but not equal. Evicted by how far it exceeds
  requests.
- **BestEffort**: no requests/limits. Evicted first.

A pod with no requests is BestEffort even if you think it is important. Set requests==limits
on critical pods to make them Guaranteed.

### Hint 2 — Memory limit vs node pressure are two mechanisms

Exceeding your own container `memory` limit → **OOMKilled** (exit 137), independent of node
state. Node running low on memory → **eviction** in QoS order. Bound hogs with a realistic
memory limit so they hit their own limit first, and give critical pods Guaranteed QoS so node
pressure does not touch them.

## Solution

Make the critical pod Guaranteed, and give the hog a realistic limit so it cannot starve the
node.

```yaml
apiVersion: v1
kind: Pod
metadata: { name: critical, namespace: default }
spec:
  containers:
    - name: c
      image: nginx:1.27-alpine
      resources:
        requests: { cpu: "100m", memory: "128Mi" }
        limits:   { cpu: "100m", memory: "128Mi" }   # requests==limits -> Guaranteed
---
apiVersion: v1
kind: Pod
metadata: { name: hog, namespace: default }
spec:
  containers:
    - name: c
      image: polinux/stress
      command: ["stress"]
      args: ["--vm", "1", "--vm-bytes", "200M", "--vm-hang", "0"]
      resources:
        requests: { memory: "200Mi" }
        limits:   { memory: "256Mi" }     # OOMKilled at its own limit, not the node's
```

```bash
kubectl apply -f workloads.yaml
kubectl get pod critical -o jsonpath='{.status.qosClass}{"\n"}'   # Guaranteed
```

- **QoS class is derived from requests/limits and drives eviction order** — BestEffort dies
  first, then Burstable by overage, Guaranteed last. A pod with no requests is BestEffort no
  matter how important you consider it.
- **Make critical pods Guaranteed** (requests == limits for cpu and memory) so node memory
  pressure evicts everything else before touching them.
- **OOMKilled ≠ Evicted.** Exceeding your own memory limit is an OOM kill (exit 137) regardless
  of node health; node-level pressure triggers evictions in QoS order. They look similar but
  have different fixes.
- **Bound the hogs.** A realistic memory *limit* makes a leaky container hit its own ceiling
  and restart, instead of consuming the node and taking neighbours down with it.
- **Set requests from real usage** (`kubectl top`, historical metrics). Requests too low
  understate a pod's footprint and mislead the scheduler; too high wastes capacity.
- **Enforce baselines** with LimitRange (default requests/limits per namespace) and
  ResourceQuota (namespace caps) so no BestEffort pod sneaks onto a shared node by accident.
