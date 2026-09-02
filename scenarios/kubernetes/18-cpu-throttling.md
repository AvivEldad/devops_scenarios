# The pod that is slow because it is being throttled

## Briefing

An app is latency-sensitive and occasionally very slow, but its CPU usage never reaches the
limit you set. The node is not busy. Something is capping it anyway.

The CPU *limit* is throttling the container via CFS quota: even brief bursts above the limit
are paused until the next scheduling period. A separate variant: a too-low memory limit
causes periodic OOM kills that look like "slowness".

## Your Task

- Deploy the app with tight limits and observe throttling despite low average CPU.
- Explain how a CPU limit throttles a container that is under its limit on average.
- Set requests/limits that remove the throttling without letting the pod run unbounded.

## Starter Files

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: crunch
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels: { app: crunch }
  template:
    metadata:
      labels: { app: crunch }
    spec:
      containers:
        - name: crunch
          image: python:3.12-slim
          command:
            - python
            - -c
            - |
              # short CPU bursts with idle gaps: average is low, peaks need >100m
              import time
              while True:
                  t=time.time()
                  while time.time()-t < 0.2:  # 200ms of burn
                      sum(i*i for i in range(10000))
                  time.sleep(0.8)             # then idle
          resources:
            requests: { cpu: "50m",  memory: "64Mi" }
            limits:   { cpu: "100m", memory: "64Mi" }   # 100m caps the bursts
```

## Expected Failure

```bash
kubectl apply -f app.yaml
# with metrics-server available:
kubectl top pod -l app=crunch
# crunch-xxxx   40m   30Mi        <- average looks fine, well under 100m
```

```bash
# but the container is being throttled during its bursts:
POD=$(kubectl get pod -l app=crunch -o name)
kubectl exec $POD -- sh -c 'cat /sys/fs/cgroup/cpu.stat 2>/dev/null || cat /sys/fs/cgroup/cpu/cpu.stat'
# nr_throttled 1200
# throttled_time 45000000000     <- large and growing: real throttling
```

Average CPU (40m) is under the 100m limit, but the *bursts* need more than 100m for 200ms.
CFS pauses the container when it exceeds quota within a 100ms period, adding latency even
though the average is low.

## Expected Outcome

Throttling stops (or is drastically reduced) and latency stabilises.

`throttled` counters stop climbing after raising or removing the CPU limit:

```bash
kubectl exec $POD -- sh -c 'cat /sys/fs/cgroup/cpu.stat' 
# nr_throttled stays flat between checks
```

Requests reflect real average usage so the scheduler places the pod well:

```bash
kubectl get deploy crunch -o jsonpath='{.spec.template.spec.containers[0].resources}{"\n"}'
# requests set to a realistic value; cpu limit raised or removed
```

The app's tail latency improves (fewer forced pauses).

## Hints

### Hint 1 — A CPU limit throttles bursts, not averages

CPU limits are enforced by CFS quota per ~100ms period. A container needing 300m for 200ms
will be paused partway through even if its *average* is 40m. `kubectl top` shows the average
and hides this — check `cpu.stat`'s `nr_throttled`/`throttled_time` in the cgroup.

### Hint 2 — Requests for scheduling, limits with care

Set `requests.cpu` to the realistic average (for the scheduler and fair sharing). For
latency-sensitive workloads, raise the CPU *limit* well above the burst need, or omit the
CPU limit entirely and rely on requests — CPU is compressible, so an unlimited container
just shares fairly rather than harming others. Keep a **memory** limit, since memory is not
compressible.

## Solution

Raise (or remove) the CPU limit so bursts are not throttled; keep a sensible request and a
memory limit.

```yaml
resources:
  requests: { cpu: "50m", memory: "64Mi" }
  limits:   { memory: "128Mi" }      # keep memory limited; drop the CPU cap
# or, if you must cap CPU, set it well above burst need, e.g. cpu: "1"
```

```bash
kubectl apply -f app.yaml
kubectl exec "$(kubectl get pod -l app=crunch -o name)" -- \
  sh -c 'cat /sys/fs/cgroup/cpu.stat'   # nr_throttled stops climbing
```

- **CPU limits throttle bursts within each ~100ms CFS period**, so a container can be
  throttled while its average sits far below the limit. `kubectl top` (average) hides this;
  the cgroup `cpu.stat` `nr_throttled`/`throttled_time` reveal it.
- **CPU is compressible; memory is not.** An over-CPU container is paused (throttled); an
  over-memory container is killed (OOM, exit 137). Treat the two limits very differently.
- **Requests drive scheduling and fair-share weight.** Set `requests.cpu` to the realistic
  average so the scheduler places the pod and it gets proportional CPU under contention.
- **Prefer omitting the CPU limit for latency-sensitive apps** (keep requests), so bursts run
  freely and only share fairly when the node is busy. Always keep a **memory** limit to
  prevent a leak from taking down the node.
- **Guaranteed QoS** (requests == limits for both cpu and memory) gives the strongest
  scheduling/eviction guarantees but reintroduces CPU throttling — choose based on whether
  latency or isolation matters more.
