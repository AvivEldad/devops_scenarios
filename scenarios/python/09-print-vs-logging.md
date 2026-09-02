# The job ran, CloudWatch has one line that says "done", and we cannot grep it

## Briefing

A Kubernetes CronJob / systemd timer runs `report.py`. On failure someone
asks "what time, which cluster, which exit?" The only captured output is:

```
checking
done
```

No timestamp, no level, no target, stdout mixed with the JSON the next CI
step tries to `jq`. `print()` is not an operations log. The platform's
log shipper adds *its* timestamp (container start), which is not the
event time if the process was long-lived.

## Your Task

- Run the script and show why the output is useless in a log backend.
- Switch to the `logging` module: timestamp, level, logger name, message
  on stderr; keep any machine-readable payload on stdout *or* a file, not
  mixed.
- A failure must log at ERROR and still exit non-zero.

## Starter Files

### file: report.py

```python
#!/usr/bin/env python3
import json
import sys


def main():
    cluster = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    print("checking")
    hosts = ["web-01", "web-02"]
    print("done")
    print(json.dumps({"cluster": cluster, "hosts": hosts}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 report.py prod 2>&1 | tee out.txt
# checking
# done
# {"cluster": "prod", "hosts": ["web-01", "web-02"]}

jq . < out.txt
# parse error: ... "checking"
```

Grep in CloudWatch for `ERROR` or `cluster=prod` finds nothing. `jq` in
the pipeline fails because logs and JSON share stdout.

## Expected Outcome

```bash
python3 report.py prod > report.json
# (stderr)
# 2026-09-02 07:12:01,441 INFO report cluster=prod checking 2 hosts
# 2026-09-02 07:12:01,442 INFO report wrote report.json

jq . report.json
# { "cluster": "prod", "hosts": ["web-01", "web-02"] }
```

Failed runs look like:

```
2026-09-02 07:12:01,441 ERROR report cluster=prod timeout talking to API
```

and the process exit code is 1.

## Hints

### Hint 1 — stderr for humans, stdout for machines

Cron, Kubernetes, and systemd journal all capture both, but **pipelines**
(`| jq`) only see stdout. Logging to stderr is the default that keeps
`jq` working.

### Hint 2 — logging.basicConfig is enough to start

`logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", stream=sys.stderr)`.
Then `log.info("cluster=%s checking", cluster)` — use `%s` lazy formatting
so you do not interpolate secrets on lines that are filtered.

## Solution

```python
import logging
import sys

log = logging.getLogger("report")

def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )
    cluster = sys.argv[1]
    log.info("cluster=%s checking", cluster)
    json.dump({"cluster": cluster, "hosts": hosts}, sys.stdout)
    sys.stdout.write("\n")
```

- **`print("done")` is not observable.** No time, no level, no fields.
- **Do not mix JSON and chatter on stdout** if a pipeline will parse it.
- **ERROR + exit 1** together; a logged error with exit 0 is python-03
  in disguise.
- **Structured logs** (`key=value` or JSON logs on stderr) make the
  shipper's grep cheap. Start with `basicConfig` before you add a stack.
