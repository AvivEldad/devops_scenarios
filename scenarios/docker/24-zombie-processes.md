# Thousands of defunct processes in a long-running container

## Briefing

A container that dispatches short-lived worker processes has been up for three weeks.
It now has 8,000 entries in its process table marked `<defunct>`, and new workers fail
to start with `Resource temporarily unavailable`.

Nothing is leaking memory. Nothing is leaking file descriptors. The container is
leaking *process table entries*, because the process at PID 1 is not doing a job that
PID 1 is uniquely responsible for.

## Your Task

- Run the container and watch defunct entries accumulate.
- Explain what a defunct (zombie) process is and why they are not being cleaned up.
- Fix it two ways: at the container level and in the application.
- Confirm the process table stays flat over time.

## Starter Files

### file: dispatcher.py

```python
import os
import time

print(f"dispatcher running as pid {os.getpid()}", flush=True)

count = 0
while True:
    pid = os.fork()
    if pid == 0:
        # child: do a tiny unit of work and exit
        os._exit(0)
    # parent: never waits for the child
    count += 1
    if count % 20 == 0:
        print(f"dispatched {count} workers", flush=True)
    time.sleep(0.05)
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY dispatcher.py .
CMD ["python", "dispatcher.py"]
```

## Expected Failure

```bash
docker build -t dispatcher .
docker run -d --name disp dispatcher
sleep 20
docker exec disp sh -c 'ps -eo pid,ppid,stat,comm | head -8'
```

```
  PID  PPID STAT COMMAND
    1     0 Ss   python
   12     1 Z    python
   13     1 Z    python
   14     1 Z    python
   ...
```

Count them:

```bash
docker exec disp sh -c 'ps -eo stat | grep -c Z'
# 380

sleep 30
docker exec disp sh -c 'ps -eo stat | grep -c Z'
# 980        <- climbing steadily, nothing is ever cleaned up
```

Eventually:

```
BlockingIOError: [Errno 11] Resource temporarily unavailable
```

The PID namespace has run out of process IDs. Each zombie holds one, and the parent
never collects the exit status that would release it.

## Expected Outcome

Defunct processes must not accumulate.

Run for a sustained period and confirm the count stays near zero:

```bash
docker run -d --name disp-fixed dispatcher
sleep 30
docker exec disp-fixed sh -c 'ps -eo stat | grep -c Z || echo 0'
# 0

sleep 60
docker exec disp-fixed sh -c 'ps -eo stat | grep -c Z || echo 0'
# 0        <- still zero after 90 seconds
```

The process table stays small:

```bash
docker exec disp-fixed sh -c 'ps -e | wc -l'
# a small, stable number - not thousands
```

Work is still being dispatched — the fix must not stop the container doing its job:

```bash
docker logs --tail 3 disp-fixed
# dispatched 1200 workers
```

**The `--init` route also works.** Verify a real init is PID 1:

```bash
docker run -d --name disp-init --init dispatcher
docker exec disp-init sh -c 'ps -eo pid,comm | head -3'
#   PID COMMAND
#     1 docker-init
#     7 python

sleep 30
docker exec disp-init sh -c 'ps -eo stat | grep -c Z || echo 0'
# 0
```

Clean up: `docker rm -f disp disp-fixed disp-init 2>/dev/null`

## Hints

### Hint 1 — A zombie is an uncollected exit status

When a process exits, the kernel keeps a minimal entry holding its exit status until the
parent calls `wait()`. That entry is a zombie: no memory, no file descriptors, just a
slot in the process table and a PID.

If the parent never waits, the zombie persists for as long as the parent lives. Here the
dispatcher forks and never waits, so every worker becomes permanent.

```bash
ps -eo pid,ppid,stat,comm | awk '$3 ~ /Z/'
```

### Hint 2 — Reaping orphans is PID 1's job, and most applications are not init

Normally when a parent dies, its children are re-parented to PID 1, which is expected to
reap them continuously. That is one of init's core responsibilities.

In a container, PID 1 is your application, and almost no application implements it. So
orphans accumulate with nobody to collect them.

Two fixes, and you should understand both:

- `docker run --init` inserts a minimal init process as PID 1 that reaps children and
  forwards signals. It requires no application change.
- Fix the application to `wait()` for its own children, which is correct regardless of
  what runs as PID 1.

## Solution

The dispatcher forked children and never collected their exit statuses, and PID 1 —
being the application itself — implemented no reaping.

**Application fix**, which is correct in any environment:

```python
import os
import signal
import time

print(f"dispatcher running as pid {os.getpid()}", flush=True)

# reap children automatically as they exit
signal.signal(signal.SIGCHLD, signal.SIG_IGN)

count = 0
while True:
    pid = os.fork()
    if pid == 0:
        os._exit(0)
    count += 1
    if count % 20 == 0:
        print(f"dispatched {count} workers", flush=True)
    time.sleep(0.05)
```

Setting `SIGCHLD` to `SIG_IGN` tells the kernel not to create zombies at all. If you
need the exit statuses, reap them explicitly instead:

```python
def reap(signum, frame):
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                break
        except ChildProcessError:
            break

signal.signal(signal.SIGCHLD, reap)
```

**Container-level fix**, which protects you from any process that misbehaves:

```bash
docker run -d --name disp --init dispatcher
```

or in Compose:

```yaml
services:
  dispatcher:
    build: .
    init: true
```

- **PID 1 has responsibilities beyond running your code**: reaping orphaned children and
  handling signals. Application runtimes generally implement neither, which is why
  containers reintroduce a problem the operating system solved decades ago.
- **`--init` is close to free and worth defaulting to** for any container that spawns
  subprocesses — shell wrappers, supervisors, anything calling out to CLI tools. It uses
  `tini`, and you can also bake it in with `ENTRYPOINT ["/sbin/tini", "--"]`.
- **Zombies consume PIDs, not memory.** The symptom is failure to create new processes,
  which surfaces as `Resource temporarily unavailable` or `fork: retry` — errors that
  point nowhere near the real cause.
- **Set `--pids-limit`** to bound the damage and turn an unbounded leak into a clear,
  early failure.
- **This affects Kubernetes identically.** `shareProcessNamespace` and the pause
  container change the picture slightly, but an application container that forks without
  reaping still accumulates zombies in its own namespace.
