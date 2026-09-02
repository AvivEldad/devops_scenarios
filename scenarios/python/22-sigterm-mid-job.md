# Kubernetes sent SIGTERM and the job wrote a half-empty dump anyway

## Briefing

A CronJob / Job has `terminationGracePeriodSeconds: 30`. The cluster
preempts the pod, systemd stops the service, or Jenkins aborts the stage.
Python's default is to die with `KeyboardInterrupt` (SIGINT) or to be
killed harder with SIGTERM **uncaught** — which looks like an instant
exit, often 143 (128+15), in the middle of `write_state`.

Python-18 is atomic publish. This is **handling SIGTERM**: stop taking
work, finish or abort the current item *cleanly*, exit non-zero so the
Job retries, do not start a 10-minute step you cannot finish.

## Your Task

- Run a long job, send SIGTERM, and show it dying mid-write (or ignoring
  the signal and getting SIGKILL 30s later).
- Install a handler that sets a flag, stops the loop, and exits 1
  (retryable) after a safe point.
- Confirm a SIGTERM during the loop does not leave a truncated artifact,
  or leaves the previous good file (combine with atomic write).

## Starter Files

### file: dump_tables.py

```python
#!/usr/bin/env python3
import os
import sys
import time

OUT = "dump.sql"


def main():
    tables = ["users", "orders", "events", "audit"]
    with open(OUT, "w") as fh:
        for t in tables:
            print("dumping %s" % t, flush=True)
            fh.write("-- begin %s\n" % t)
            time.sleep(2)          # stand-in for pg_dump piece
            fh.write("-- end %s\n" % t)
            fh.flush()
    print("dump complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 dump_tables.py &
sleep 3
kill -TERM $!
wait $!; echo exit=$?
# dumping users
# dumping orders
# (process gone)
# exit=143
cat dump.sql
# -- begin users
# -- end users
# -- begin orders
#          (no -- end orders)
```

The Job controller may still mark the run Failed, but the artifact is
poison. A caller that treats 143 as "ok enough" is worse.

## Expected Outcome

```bash
python3 dump_tables.py &
sleep 3
kill -TERM $!
wait $!; echo exit=$?
# dumping users
# dumping orders
# interrupted by SIGTERM after table orders — not publishing dump.sql
# exit=1
# dump.sql is the previous complete file, or absent
```

On a clean run of all tables, exit 0 and a complete dump.

## Hints

### Hint 1 — SIGTERM is the contract

Kubernetes, systemd, and docker stop send SIGTERM then SIGKILL. Catch
`signal.SIGTERM` (and SIGINT) with a handler that sets `stop = True`.
You cannot do real work in the handler; just set a flag.

### Hint 2 — Exit 1 so the Job retries

Exit 0 after a partial dump tells the platform the snapshot is good.
Exit 1 / 143 without a published file is the honest result.

## Solution

```python
import signal

stop = False

def _stop(signum, frame):
    global stop
    stop = True

signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)

for t in tables:
    if stop:
        print("interrupted by SIGTERM — not publishing", file=sys.stderr)
        return 1
    dump_one(t)
os.replace(tmp, OUT)
```

- **Uncaught SIGTERM is a mid-file crash.** Combine with atomic replace.
- **Grace period is not extra runtime to start more work.**
- **143 vs 1:** prefer a handled exit 1 with a log line the next on-call
  can grep.
- **`subprocess` children** need the same signal or `start_new_session`
  so kubectl/pg_dump die with the parent.
