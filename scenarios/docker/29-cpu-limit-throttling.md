# The container that thinks it has 64 CPUs

## Briefing

A Java-style thread-pool service — here reproduced in Python — is deployed with
`--cpus=2` on a 64-core host. Under load it spawns 64 worker threads, thrashes, and
its latency is worse than on a developer laptop with 8 cores.

The application sizes its pool from the CPU count it detects. Inside the container, the
count it detects is the host's, not its own limit. This is one of the most expensive
and least obvious container misconfigurations in production.

## Your Task

- Run the container with a CPU limit and have it report how many CPUs it believes it
  has.
- Show that the detected count ignores the limit.
- Make the application see a count consistent with its limit.
- Confirm the worker pool is sized correctly and enforce the limit two ways.

## Starter Files

### file: app.py

```python
import os

# how most runtimes size their thread/worker pools
detected = os.cpu_count()
pool_size = detected * 2

print(f"detected CPUs: {detected}")
print(f"sizing worker pool to: {pool_size}")

# what the cgroup actually permits, if anyone looks
try:
    quota = int(open("/sys/fs/cgroup/cpu.max").read().split()[0])
    period = int(open("/sys/fs/cgroup/cpu.max").read().split()[1])
    print(f"cgroup cpu.max: {quota}/{period} = {quota/period:.2f} CPUs")
except Exception as exc:
    print(f"could not read cgroup cpu.max: {exc}")
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY app.py .
CMD ["python", "app.py"]
```

## Expected Failure

```bash
docker build -t pool .
docker run --rm --cpus=2 pool
```

On a many-core host:

```
detected CPUs: 64
sizing worker pool to: 128
cgroup cpu.max: 200000/100000 = 2.00 CPUs
```

`os.cpu_count()` returned 64 — the host's core count — while the cgroup permits the
equivalent of 2 CPUs. The application built a 128-thread pool to run on 2 CPUs worth of
scheduler time. The result is heavy context-switching and CFS throttling: the kernel
suspends the process whenever it exhausts its quota within each 100 ms period.

Confirm the throttling under load:

```bash
docker run -d --name pool --cpus=2 python:3.11-slim \
  python -c "import concurrent.futures,os
with concurrent.futures.ThreadPoolExecutor(os.cpu_count()*2) as ex:
    while True: list(ex.map(lambda _: sum(range(10000)), range(1000)))"
sleep 5
docker exec pool cat /sys/fs/cgroup/cpu.stat | grep throttled
# nr_throttled 47
# throttled_usec 3800000       <- being suspended constantly
docker rm -f pool
```

## Expected Outcome

The application sizes itself to its actual CPU allowance.

**The detected count reflects the limit:**

```bash
docker run --rm --cpus=2 pool
# effective CPUs: 2
# sizing worker pool to: 4
```

**A different limit produces a different pool size:**

```bash
docker run --rm --cpus=4 pool
# effective CPUs: 4
# sizing worker pool to: 8
```

**With no limit it uses the host count**, which is correct in that case:

```bash
docker run --rm pool
# effective CPUs: <host count>
```

**Under load, throttling drops sharply** compared to the oversized pool:

```bash
# with a correctly sized pool, nr_throttled stays low relative to runtime
docker exec <container> cat /sys/fs/cgroup/cpu.stat | grep nr_throttled
```

**The limit is enforced and visible:**

```bash
docker run --rm --cpus=2 pool cat /sys/fs/cgroup/cpu.max
# 200000 100000
```

## Hints

### Hint 1 — `os.cpu_count()` and friends read the host

The standard CPU-count calls in most languages report the number of cores the kernel
sees, which is the host's, ignoring cgroup CPU limits entirely. Java before 8u191,
Node's `os.cpus()`, Go's default `GOMAXPROCS` before 1.25, and Python's `os.cpu_count()`
all have this behaviour.

The real allowance is in the cgroup:

```bash
cat /sys/fs/cgroup/cpu.max      # "quota period" -> quota/period CPUs (cgroup v2)
```

### Hint 2 — Compute the effective limit and size from it

Read the cgroup and derive the CPU allowance, falling back to the host count when there
is no quota:

```python
def effective_cpus():
    try:
        quota, period = open("/sys/fs/cgroup/cpu.max").read().split()
        if quota != "max":
            return max(1, round(int(quota) / int(period)))
    except OSError:
        pass
    return os.cpu_count()
```

Many runtimes now do this automatically when told to: the JVM's
`-XX:+UseContainerSupport` (default since Java 10), Go 1.25's container-aware
`GOMAXPROCS`, or libraries that read the cgroup. Prefer those over hand-rolling where
they exist.

## Solution

The application read the host CPU count and sized a pool far larger than its quota,
causing context-switch overhead and CFS throttling.

```python
import os


def effective_cpus():
    # cgroup v2
    try:
        data = open("/sys/fs/cgroup/cpu.max").read().split()
        if data[0] != "max":
            return max(1, round(int(data[0]) / int(data[1])))
    except OSError:
        pass
    # cgroup v1 fallback
    try:
        quota = int(open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read())
        period = int(open("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read())
        if quota > 0:
            return max(1, round(quota / period))
    except OSError:
        pass
    return os.cpu_count() or 1


cpus = effective_cpus()
pool_size = cpus * 2
print(f"effective CPUs: {cpus}")
print(f"sizing worker pool to: {pool_size}")
```

Enforce and document the limit at run time and in Compose:

```bash
docker run --rm --cpus=2 pool
```

```yaml
services:
  pool:
    build: .
    deploy:
      resources:
        limits:
          cpus: "2"
        reservations:
          cpus: "1"
```

- **CPU-count APIs report the host, not the cgroup, in most runtimes.** Any code that
  sizes a thread pool, worker count or `GOMAXPROCS` from that number will over-provision
  massively when limited, and the symptom is high latency with no obvious error.
- **CFS throttling is the mechanism to understand.** A `--cpus=2` limit is a quota of 200
  ms of CPU per 100 ms period across all threads. Exceed it and the kernel suspends every
  thread until the next period — visible as latency spikes and `nr_throttled` in
  `cpu.stat`. More threads make this worse, not better.
- **Prefer the runtime's container awareness** where it exists: `UseContainerSupport`
  (JVM), automatic `GOMAXPROCS` (Go 1.25+, or the `automaxprocs` library earlier),
  `--cpu` flags. Hand-reading the cgroup is the fallback for runtimes that lack it.
- **Memory has the identical problem.** `/proc/meminfo` shows host memory; a JVM sizing
  its heap from that will exceed the container's memory limit and be OOM-killed. The fix
  is the same shape: read the cgroup, or use `-XX:MaxRAMPercentage`.
- **Requests and limits are different levers.** In Kubernetes, the CPU *request* affects
  scheduling and the *limit* causes throttling. Many latency-sensitive services
  deliberately set a request without a hard limit to avoid throttling — a real design
  choice this scenario should make you aware of.
