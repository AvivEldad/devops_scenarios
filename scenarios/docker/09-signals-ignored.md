# `docker stop` takes ten seconds and kills the job

## Briefing

Every deployment takes an extra ten seconds per container, and in-flight work is lost
rather than finished. The application has clean shutdown handling — it logs
`shutting down gracefully` — and that message never appears.

The process is not receiving the signal. One line in the Dockerfile is the reason.

## Your Task

- Start the container and stop it. Time how long it takes.
- Confirm the shutdown handler never runs.
- Find out what PID 1 actually is inside the container.
- Fix it so shutdown is immediate and graceful.

## Starter Files

### file: server.py

```python
import signal
import sys
import time

running = True


def handle(signum, frame):
    global running
    print(f"shutting down gracefully (signal {signum})", flush=True)
    running = False


signal.signal(signal.SIGTERM, handle)
signal.signal(signal.SIGINT, handle)

print("server started", flush=True)
while running:
    time.sleep(1)

print("finished in-flight work, exiting", flush=True)
sys.exit(0)
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY server.py .
CMD python server.py
```

## Expected Failure

```bash
docker build -t srv .
docker run -d --name s1 srv
docker logs s1
# server started

time docker stop s1
```

```
s1
real    0m10.412s
```

Ten seconds, and the logs show no shutdown message:

```bash
docker logs s1
# server started
```

Docker sent `SIGTERM`, waited ten seconds for a response, got none, and sent `SIGKILL`.
Look at what is actually running as PID 1:

```bash
docker run -d --name s2 srv
docker exec s2 ps -eo pid,comm
#   PID COMMAND
#     1 sh
#     7 python
```

## Expected Outcome

Shutdown is immediate and clean.

```bash
docker run -d --name s3 srv
time docker stop s3
# real  0m0.3s      <- not 10 seconds
```

The handler ran:

```bash
docker logs s3
# server started
# shutting down gracefully (signal 15)
# finished in-flight work, exiting
```

The application is PID 1:

```bash
docker run -d --name s4 srv
docker exec s4 ps -eo pid,comm
#   PID COMMAND
#     1 python
```

The exit code reflects a clean exit rather than a kill:

```bash
docker wait s3
# 0        <- not 137 (128 + SIGKILL)
```

Clean up: `docker rm -f s1 s2 s3 s4 2>/dev/null`

## Hints

### Hint 1 — Shell form wraps your process in a shell

```dockerfile
CMD python server.py          # shell form -> /bin/sh -c "python server.py"
CMD ["python", "server.py"]   # exec form  -> python is PID 1
```

In shell form, `/bin/sh` becomes PID 1 and your program is a child. A minimal `sh` does
not forward signals to its children, so `SIGTERM` goes to the shell, the shell ignores
it, and your handler never runs.

### Hint 2 — PID 1 has special signal semantics

The kernel gives PID 1 no default signal handlers. A process that has not explicitly
installed a handler for `SIGTERM` will simply not die from it when it is PID 1 —
which is why the ten-second timeout then escalates to `SIGKILL`.

Your Python program *does* install handlers, so making it PID 1 is sufficient here. For
programs that do not, or that spawn children needing reaping, add a minimal init:
`docker run --init`, or `tini` as the entrypoint.

## Solution

`CMD` in shell form put `/bin/sh` at PID 1, and it swallowed the signal.

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY server.py .

STOPSIGNAL SIGTERM
CMD ["python", "server.py"]
```

- **Always use exec form (the JSON array) for `CMD` and `ENTRYPOINT`.** Shell form
  breaks signal delivery, and it is the cause of nearly every "container takes ten
  seconds to stop" report.
- **Shell form is only appropriate when you genuinely need shell features** — variable
  expansion, pipes, `&&`. When you do, make the shell hand over its process identity:
  `CMD ["sh", "-c", "exec python server.py"]`. The `exec` replaces the shell rather than
  forking, so your process becomes PID 1.
- **`docker run --init`** inserts a tiny init process that forwards signals and reaps
  zombies. Use it when your main process spawns children, otherwise defunct processes
  accumulate — PID 1 is the only process required to reap orphans, and most application
  runtimes do not.
- **This is exactly the Kubernetes `terminationGracePeriodSeconds` problem.** A pod that
  takes the full grace period to terminate and then gets killed is almost always this
  same fault, and it turns every rolling update into dropped connections.
- **Exit code 137** means 128 + 9, killed by `SIGKILL`. Seeing it after a stop is the
  signature. A clean shutdown gives 0, or 143 (128 + 15) if the process exits on
  `SIGTERM` without changing the code.
