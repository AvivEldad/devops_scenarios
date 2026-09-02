# The node that went NotReady and took the pods with it

## Briefing

One node shows `NotReady`. Pods on it are stuck `Terminating` or still listed as `Running`
even though they answer nothing. New pods are not being scheduled there. The rest of the
cluster is fine.

The kubelet on that node has stopped reporting — commonly disk pressure filling the root
filesystem, the kubelet or container runtime crashed, or the node lost network to the API
server. Kubernetes waits before evicting, so pods linger in limbo.

## Your Task

- Identify a `NotReady` node and determine why the kubelet stopped reporting.
- Explain why pods on it are not immediately rescheduled elsewhere.
- Recover the node (or drain it) so workloads run on healthy capacity.

## Starter Files

### file: triage.md

```text
Symptoms:
  kubectl get nodes
    NAME       STATUS     ROLES    AGE   VERSION
    node-a     Ready      <none>   40d   v1.30.2
    node-b     NotReady   <none>   40d   v1.30.2     <- this one

  kubectl get pods -o wide | grep node-b
    api-7d..   1/1   Running       ... node-b   (but not actually serving)
    web-5f..   1/1   Terminating   ... node-b   (stuck)

Likely causes to check on node-b:
  - disk full (DiskPressure): kubelet cannot write, containers cannot start
  - kubelet or containerd/docker crashed or stopped
  - node lost network to the API server (still 'running' but unreachable)
```

## Expected Failure

```bash
kubectl get nodes
# node-b   NotReady   <none>   40d   v1.30.2

kubectl describe node node-b | grep -A1 -E 'DiskPressure|MemoryPressure|Ready'
# DiskPressure   True    kubelet has disk pressure
# Ready          Unknown  Kubelet stopped posting node status
```

```bash
kubectl get pods -o wide | grep node-b
# web-5f..  Terminating  ...  node-b   <- cannot be removed; kubelet is not responding
```

`Ready: Unknown` with "Kubelet stopped posting node status" means the control plane has not
heard from the node. Pods are not instantly moved because Kubernetes waits out the
eviction timeout (default ~5 min) before declaring them lost — avoiding mass eviction on a
brief network blip.

## Expected Outcome

Workloads run on healthy nodes; the bad node is recovered or safely drained.

The node returns to `Ready` after the root cause is cleared:

```bash
kubectl get nodes
# node-b   Ready   <none>   40d   v1.30.2
```

Or it is cordoned and drained so nothing schedules there while you fix it:

```bash
kubectl cordon node-b
kubectl drain node-b --ignore-daemonsets --delete-emptydir-data
# pods reschedule onto healthy nodes
```

Stuck pods are cleared and rescheduled:

```bash
kubectl get pods -o wide
# no pods stuck Terminating on node-b; replicas Running on other nodes
```

## Hints

### Hint 1 — Ask the node why it stopped reporting

```bash
kubectl describe node node-b | sed -n '/Conditions/,/Addresses/p'
```

`DiskPressure: True` or `Ready: Unknown` point the way. On the node itself (SSH):
`systemctl status kubelet`, `journalctl -u kubelet`, `df -h /var/lib` (disk), and the
container runtime status. Most `NotReady` nodes are a full disk or a dead kubelet/runtime.

### Hint 2 — Cordon and drain to move work safely

If you cannot fix it immediately, `kubectl cordon` stops new scheduling and
`kubectl drain --ignore-daemonsets` evicts pods respecting PodDisruptionBudgets so replicas
move to healthy nodes. For pods truly stuck because the kubelet is gone, deleting the pod
(or the node object, once you are sure the node is dead) lets controllers recreate them
elsewhere.

## Solution

Find the cause on the node, clear it (e.g. free disk), and let it rejoin — or drain it.

```bash
# 1) diagnose
kubectl describe node node-b | sed -n '/Conditions/,/Addresses/p'
# on node-b:  df -h /var/lib   ; journalctl -u kubelet -n 100 ; systemctl status containerd

# 2a) fix the root cause (example: disk full)
#     remove unused images/logs, then:
#     systemctl restart kubelet

# 2b) or move work off it safely
kubectl cordon node-b
kubectl drain node-b --ignore-daemonsets --delete-emptydir-data

# 3) once healthy again
kubectl uncordon node-b
kubectl get nodes
```

- **`Ready: Unknown` means the control plane lost contact with the kubelet** — network,
  crashed kubelet, or a wedged node. `Ready: False` with a condition like `DiskPressure`
  means the kubelet is reporting a specific problem. Read `describe node` first.
- **Pods are not evicted instantly on NotReady.** The node's eviction timeout (default ~5
  min) prevents mass rescheduling on transient blips. That is why pods sit `Running`/`Terminating`
  in limbo — expected, not stuck forever.
- **DiskPressure is the most common cause.** A full `/var/lib` (images, logs, ephemeral
  storage) stops the kubelet writing; clean up and it recovers. Set log rotation and image GC
  to prevent recurrence.
- **`cordon` + `drain` is the safe recovery** — it respects PodDisruptionBudgets and
  DaemonSets, moving workloads to healthy nodes without a thundering herd. Delete the node
  object only when you are certain it is gone for good.
- **PodDisruptionBudgets protect availability during drains**; if a drain hangs, a PDB may be
  correctly refusing to take the last healthy replica down — scale up first, then drain.
