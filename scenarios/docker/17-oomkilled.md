# Exit code 137 and no error in the logs

## Briefing

A data-processing container dies partway through every large job. The application logs
stop mid-run with no exception, no traceback, and no shutdown message. The container's
exit code is 137.

The team's theory is a bug in the parsing code. There is no bug in the parsing code.
Something outside the process ended it, and the process was never told.

## Your Task

- Run the job with the given memory limit and reproduce the sudden death.
- Determine what killed it, using evidence from Docker rather than the application.
- Distinguish this from an application crash and from `docker stop`.
- Make the failure visible and then make the job survive.

## Starter Files

### file: job.py

```python
import sys
import time

print("starting import job", flush=True)

rows = []
for batch in range(1, 21):
    # each batch holds ~20 MB in memory and nothing is ever released
    rows.append(bytearray(20 * 1024 * 1024))
    print(f"loaded batch {batch}/20 ({len(rows) * 20} MB held)", flush=True)
    time.sleep(0.3)

print("import complete", flush=True)
sys.exit(0)
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY job.py .
CMD ["python", "job.py"]
```

## Expected Failure

```bash
docker build -t importer .
docker run --name job1 --memory=128m importer
```

```
starting import job
loaded batch 1/20 (20 MB held)
loaded batch 2/20 (40 MB held)
loaded batch 3/20 (60 MB held)
loaded batch 4/20 (80 MB held)
loaded batch 5/20 (100 MB held)
```

Then nothing. No traceback, no `import complete`, no error.

```bash
docker inspect job1 --format '{{.State.ExitCode}} {{.State.OOMKilled}}'
# 137 true
```

The application never had a chance to log anything: `SIGKILL` cannot be caught, so no
handler runs and any buffered output is lost.

## Expected Outcome

The failure is attributable, and then the job completes.

**You can identify the cause from Docker's state**, not by guessing:

```bash
docker inspect job1 --format '{{.State.OOMKilled}}'
# true
```

**You can distinguish the three ways a container dies.** Produce each and confirm the
exit codes differ:

```bash
# application error
docker run --rm --entrypoint python importer -c "raise SystemExit(3)"; echo "exit=$?"
# exit=3

# docker stop -> SIGTERM
docker run -d --name t1 --entrypoint sleep importer 300 && docker stop t1 >/dev/null
docker inspect t1 --format '{{.State.ExitCode}} {{.State.OOMKilled}}'
# 137 false        <- killed, but NOT out of memory

# out of memory
docker inspect job1 --format '{{.State.ExitCode}} {{.State.OOMKilled}}'
# 137 true
```

**The job completes within a sensible limit:**

```bash
docker run --rm --memory=128m importer
# starting import job
# loaded batch 1/20 ...
# ...
# loaded batch 20/20 ...
# import complete
```

**Peak memory stays under the limit.** Watch it while running:

```bash
docker run -d --name job2 --memory=128m importer
docker stats --no-stream job2
# MEM USAGE / LIMIT: well under 128MiB
```

**The limit is actually enforced** — confirm the container sees it:

```bash
docker run --rm --memory=128m importer cat /sys/fs/cgroup/memory.max
# 134217728
```

Clean up: `docker rm -f job1 job2 t1 2>/dev/null`

## Hints

### Hint 1 — 137 means killed by signal 9

Container exit codes follow the shell convention: `128 + signal`. So 137 is
`128 + 9` = `SIGKILL`, and 143 is `128 + 15` = `SIGTERM`.

`SIGKILL` cannot be caught, blocked, or handled. The process is removed immediately, so
there is never a traceback and any buffered output is discarded — which is exactly why
the logs stop mid-sentence.

The two common sources are the kernel OOM killer and `docker kill`. Docker records
which:

```bash
docker inspect <name> --format '{{.State.OOMKilled}}'
```

Also check the host, where the kernel logs the decision:

```bash
dmesg -T | grep -i 'killed process'
journalctl -k | grep -i oom
```

### Hint 2 — Fix the memory usage, not just the limit

Raising the limit makes this job pass and the next one fail. The application holds
every batch for the whole run, so its memory grows linearly with input size — it will
exceed any fixed limit given enough data.

Process and release, rather than accumulating:

```python
for batch in range(1, 21):
    chunk = bytearray(20 * 1024 * 1024)
    process(chunk)
    del chunk          # or simply let it go out of scope
```

Streaming is the general answer: constant memory regardless of input size.

## Solution

The kernel OOM killer terminated the process because it exceeded the container's
memory limit. The application accumulated every batch instead of releasing it.

```python
import sys
import time

print("starting import job", flush=True)

total = 0
for batch in range(1, 21):
    # process one batch at a time; it is released when it goes out of scope
    chunk = bytearray(20 * 1024 * 1024)
    total += len(chunk)
    print(f"processed batch {batch}/20 ({total // (1024*1024)} MB cumulative)",
          flush=True)
    del chunk
    time.sleep(0.3)

print("import complete", flush=True)
sys.exit(0)
```

Set the limit deliberately, with a reservation, and keep the swap limit equal to the
memory limit so the container cannot quietly swap instead of failing fast:

```bash
docker run --rm \
  --memory=128m \
  --memory-swap=128m \
  --memory-reservation=96m \
  importer
```

- **137 with `OOMKilled: true` is the memory limit; 137 with `false` is a kill from
  outside.** That single inspect field separates two very different investigations, and
  it is the first thing to check whenever logs stop without an error.
- **`SIGKILL` guarantees no diagnostics from the application.** Any explanation must come
  from the runtime, the kernel log, or metrics — never from the process itself. Combined
  with buffered output, you may also lose the last several seconds of logs that *were*
  produced, which is why unbuffered logging matters so much in containers.
- **Limits expose memory bugs; they do not cause them.** A job whose memory grows with
  input will fail at some size regardless. Raising the limit converts a fast, cheap
  failure into a slow, expensive one.
- **`--memory-swap` equal to `--memory` disables swap for the container.** Without it, a
  leaking process can thrash for a long time before dying, which is much harder to
  diagnose than a clean OOM kill.
- **In Kubernetes this is `OOMKilled` in the pod status**, driven by the container's
  memory *limit*. A pod that restarts repeatedly with `Last State: Terminated, Reason:
  OOMKilled` is this exact scenario, and `kubectl logs --previous` is where the truncated
  output lives.
