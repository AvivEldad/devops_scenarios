# Two crons ran the drain and the node was cordoned twice into a deadlock

## Briefing

`drain_and_patch.py` takes 8 minutes. Cron is `*/5 * * * *`. When the API
is slow, a second process starts. Both cordon, both patch, both try to
uncordon. You get double deploys, duplicate Jira tickets, or a lock in
an external system that was not written for concurrency.

Python does not serialize your CronJobs. You need an **exclusive lock**
(flock, or a lease in k8s/etcd) and a documented behaviour when the lock
is held: exit 0 "skipped" vs exit 1 "blocked" — pick one and log it.

## Your Task

- Start two copies of the job and show they both enter the critical
  section.
- Take an exclusive flock on a lockfile; the second process must skip or
  fail without doing the work.
- Log which pid held the lock.

## Starter Files

### file: drain_and_patch.py

```python
#!/usr/bin/env python3
import os
import sys
import time

STAMP = "work.log"


def main():
    print("pid %s starting drain" % os.getpid(), flush=True)
    time.sleep(3)   # stand-in for a slow API
    with open(STAMP, "a") as fh:
        fh.write("did-work pid=%s\n" % os.getpid())
    print("pid %s done" % os.getpid(), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 drain_and_patch.py & python3 drain_and_patch.py & wait
cat work.log
# did-work pid=111
# did-work pid=222
```

Two workers both "did the drain". In production that is two simultaneous
rollouts.

## Expected Outcome

```bash
python3 drain_and_patch.py & python3 drain_and_patch.py & wait
cat work.log
# did-work pid=111
# (only one line)
```

The loser logs `skipped: lock held by other drain_and_patch` and exits 0
(if overlapping is expected) or 1 (if overlapping means cron is mis-set).

## Hints

### Hint 1 — flock is enough on one box

`fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)`. Hold the fd open for
the whole job. A lockfile you `unlink` too early is not a lock.

### Hint 2 — Two pods need a distributed lock

flock is per node. Two Kubernetes CronJob pods need a Lease/ConfigMap
lock or `concurrencyPolicy: Forbid`. Do not assume the filesystem lock
survives a second replica.

## Solution

```python
import fcntl

def main():
    lock_fh = open("drain.lock", "w")
    try:
        fcntl.flock(lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("skipped: lock held", file=sys.stderr)
        return 0
    lock_fh.write("%s\n" % os.getpid())
    lock_fh.flush()
    # ... real work ...
```

- **Cron + long job = overlap** unless you forbid it.
- **Log skip vs work** so "the job always succeeds" is still auditable.
- **`concurrencyPolicy: Forbid`** is the k8s-native flock.
- **Never unlock by deleting the file first**; close the fd at process
  exit.
