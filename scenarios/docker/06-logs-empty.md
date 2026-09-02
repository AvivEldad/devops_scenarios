# The container is working and `docker logs` is empty

## Briefing

A batch job runs in a container for twenty minutes. `docker logs` shows nothing for
the entire run, then dumps everything at once when the process exits — or shows
nothing at all if the container is killed.

During an incident this is the difference between watching a job progress and staring
at a blank terminal wondering whether it is stuck.

## Your Task

- Run the container and observe that output does not appear as it is produced.
- Kill it mid-run and confirm the output is lost entirely.
- Fix it so every line appears immediately, and understand why it was buffered.

## Starter Files

### file: worker.py

```python
import sys
import time

for i in range(1, 11):
    print(f"processing batch {i}/10")
    time.sleep(2)

print("done", file=sys.stderr)
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /srv
COPY worker.py .
CMD ["python", "worker.py"]
```

## Expected Failure

```bash
docker build -t worker .
docker run --name w1 worker
```

Nothing appears for twenty seconds, then all ten lines arrive together. Worse:

```bash
docker run -d --name w2 worker
sleep 6
docker logs w2
# (empty - three batches have completed and produced no visible output)

docker kill w2
docker logs w2
# still empty: the buffered output died with the process
```

## Expected Outcome

Output appears line by line as it is produced:

```bash
docker run --rm worker
# processing batch 1/10      <- appears immediately
# processing batch 2/10      <- two seconds later
# ...
```

Logs are visible from a detached container while it is still running:

```bash
docker run -d --name w3 worker
sleep 5
docker logs w3
# processing batch 1/10
# processing batch 2/10
# processing batch 3/10
```

Output survives a kill:

```bash
docker kill w3
docker logs w3
# the batches completed before the kill are still there
```

Following works in real time:

```bash
docker run -d --name w4 worker && docker logs -f w4
# lines stream as they happen
```

Clean up: `docker rm -f w1 w2 w3 w4 2>/dev/null`

## Hints

### Hint 1 — stdout buffering depends on what it is connected to

Most language runtimes line-buffer stdout when it is a terminal and switch to a large
block buffer (typically 4 or 8 KB) when it is a pipe or file.

A container's stdout is a pipe to the Docker daemon, not a terminal. So the same
program that streams nicely on your laptop buffers silently in a container — and the
buffer is discarded if the process is killed rather than exiting cleanly.

### Hint 2 — Turn it off explicitly

For Python:

```dockerfile
ENV PYTHONUNBUFFERED=1
```

or run with `python -u`. The equivalents elsewhere: `STDBUF` / `stdbuf -oL` for
arbitrary binaries, `$| = 1` in Perl, `setvbuf` in C. Node.js and Go are unbuffered for
stdout by default and do not need this.

Note that `stderr` is usually unbuffered already, which is why the final `done` line
behaves differently from the rest.

## Solution

Python block-buffers stdout when it is not a terminal, so nothing reaches the daemon
until the buffer fills or the process exits.

```dockerfile
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv
COPY worker.py .
CMD ["python", "worker.py"]
```

- **`PYTHONUNBUFFERED=1` belongs in essentially every Python container image.** It costs
  nothing and it is the difference between having logs during an incident and not.
- **Buffered output is lost on `SIGKILL`.** This is the part that matters most: the job
  that got OOM-killed at batch 7 will show you nothing about batches 1 to 6, so you
  cannot tell how far it got.
- **Log to stdout and stderr, not to files inside the container.** The container runtime
  collects the streams and forwards them to whatever log driver is configured. A log
  file inside a container is invisible to `docker logs`, to `kubectl logs`, and to your
  log aggregator, and it disappears when the container does.
- **`PYTHONDONTWRITEBYTECODE=1`** is unrelated but conventional in the same place: it
  stops `.pyc` files being written into the image layer at runtime.
