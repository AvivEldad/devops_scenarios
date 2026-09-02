# node-exporter scraped a textfile of zero bytes and Grafana said the box was gone

## Briefing

`write_metrics.py` is a cron that writes
`/var/lib/node_exporter/textfile/app.prom` for the node_exporter textfile
collector. On API failure the script prints nothing, exits 0 (so cron is
quiet), and leaves a **truncated or empty** `.prom` — or writes
`app_up 0` without a `\n`, or uses a changing label set (`batch_id`)
that explodes cardinality.

Python-18 is atomic replace. This drill is the **Prometheus textfile
contract**: valid exposition format, stable labels, non-zero exit on
failure *or* an explicit `app_up 0` sample, never an empty file that
looks like "the exporter died".

## Your Task

- Fail the "API" and show the writer still exiting 0 with an empty/invalid
  textfile.
- On failure: keep the last good file **or** atomically write `app_up 0`
  with a comment, and exit 1 so cron/k8s notices.
- On success: write HELP/TYPE, a trailing newline, stable labels, via
  temp + replace.

## Starter Files

### file: write_metrics.py

```python
#!/usr/bin/env python3
import random
import sys

OUT = "app.prom"


def fetch_ok():
    return "--fail" not in sys.argv


def main():
    if not fetch_ok():
        open(OUT, "w").close()     # truncated "so we don't publish stale"
        print("api down, wrote empty textfile")
        return 0
    batch = random.randint(1, 10**9)
    open(OUT, "w").write('app_up{batch="%s"} 1' % batch)  # no HELP, no newline
    print("wrote", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 write_metrics.py --fail; echo exit=$?
# api down, wrote empty textfile
# exit=0
cat app.prom
# (empty)
```

node_exporter may drop the metric; Grafana shows a hole. Cron is green.

Success path is also messy:

```bash
python3 write_metrics.py
cat app.prom
# app_up{batch="381192847"} 1     # no trailing newline; cardinality leak
```

## Expected Outcome

```bash
python3 write_metrics.py --fail; echo exit=$?
# error: api down — publishing app_up 0
# exit=1
cat app.prom
# # HELP app_up Whether the last scrape of the app API succeeded
# # TYPE app_up gauge
# app_up 0
```

```bash
python3 write_metrics.py
cat app.prom
# # HELP app_up ...
# # TYPE app_up gauge
# app_up 1
```

No `batch` label. Trailing newline. Atomic replace.

## Hints

### Hint 1 — Empty file is not "stale is bad"

Stale-but-correct `app_up 1` plus a separate `app_scrape_timestamp` is
often better than wiping the metric. If you must not be stale, publish
`app_up 0` explicitly.

### Hint 2 — Exposition format is picky

HELP/TYPE before samples, `\n` at EOF, no changing high-cardinality
labels (`batch`, `request_id`, timestamps-as-labels).

## Solution

```python
from pathlib import Path
import os
from tempfile import NamedTemporaryFile

body = "# HELP app_up ...\n# TYPE app_up gauge\napp_up %d\n" % (1 if ok else 0)
with NamedTemporaryFile("w", dir=".", delete=False, suffix=".prom") as fh:
    fh.write(body)
    fh.flush()
    os.fsync(fh.fileno())
    tmp = fh.name
os.replace(tmp, OUT)
return 0 if ok else 1
```

- **Exit 0 plus an empty textfile** hides the outage from cron *and*
  from Grafana.
- **Cardinality:** a new label value per run is a memory leak in
  Prometheus.
- **Always end with a newline.** The collector's parser is not your
  friend.
- **Atomic replace** (python-18) still applies; textfile reads during
  scrape.
