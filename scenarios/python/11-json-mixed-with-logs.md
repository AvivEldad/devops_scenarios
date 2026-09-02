# jq says parse error and kubectl said the object was fine

## Briefing

`nodes.py` shells out to `kubectl get nodes -o json` (here: a stand-in
command) and `json.loads` the output. The wrapper also `print`s progress
on stdout, or kubectl itself printed a warning on stdout. `jq` and
`json.loads` then fail with `Extra data` / `Expecting value`. The pipeline
marks the cluster as empty and skips the drain.

Python-09 is about logging vs JSON for *your* output. This one is about
**parsing someone else's command** when stdout is not pure JSON.

## Your Task

- Run the wrapper and show `json.loads` failing (or silently capturing
  zero nodes).
- Isolate the JSON: parse only stdout from the child, keep *your* logs on
  stderr, and do not merge kubectl warnings into the parse buffer.
- Exit non-zero if the payload is not JSON.

## Starter Files

### file: fake-kubectl.py

```python
#!/usr/bin/env python3
import json
import sys

print("Warning: would update clusterrole.rbac.authorization.k8s.io", file=sys.stdout)
json.dump({"items": [{"metadata": {"name": "node-a"}}]}, sys.stdout)
sys.stdout.write("\n")
```

### file: nodes.py

```python
#!/usr/bin/env python3
import json
import subprocess
import sys


def main():
    print("fetching nodes")
    out = subprocess.check_output([sys.executable, "fake-kubectl.py"], text=True)
    data = json.loads(out)
    for n in data["items"]:
        print(n["metadata"]["name"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 nodes.py
# fetching nodes
# Traceback: json.decoder.JSONDecodeError: Extra data / Expecting value
```

The warning line is not JSON. `check_output` captured it together with the
document. (If you `print("fetching")` to stdout and then pipe the whole
script, the next `jq` fails even when kubectl was clean.)

## Expected Outcome

```bash
python3 nodes.py
# fetching nodes          # on stderr
# node-a

python3 nodes.py 2>/dev/null | tail -1
# node-a
```

A non-JSON child fails with the first 200 bytes of stdout in the error,
exit 1, no traceback to Slack.

## Hints

### Hint 1 — check_output is stdout only — but kubectl warnings may be there

Some tools write warnings to stdout. Prefer `kubectl ... -o json` with
`--warnings-as-errors` off/on as appropriate, or strip a known prefix.
Never `shell=True` and `2>&1` into the parser (that is python-03's
capture bug plus this one).

### Hint 2 — Your prints belong on stderr

`print("fetching nodes", file=sys.stderr)` so this script can itself be
piped. Parse `proc.stdout` after `subprocess.run(..., capture_output=True,
text=True, check=True)`.

## Solution

```python
proc = subprocess.run(
    [sys.executable, "fake-kubectl.py"],
    capture_output=True, text=True, check=True,
)
try:
    data = json.loads(proc.stdout)
except json.JSONDecodeError as exc:
    print("error: kubectl stdout is not JSON: %r" % proc.stdout[:200],
          file=sys.stderr)
    return 1
```

If the child mixes a warning, fix the child flags or split on the first
`{`. Guessing is worse than failing.

- **JSON parsers need a single document**, not logs + document.
- **`2>&1` into `json.loads`** is a standard pipeline outage.
- **Fail with a snippet**, not a 40-line traceback, when the payload is
  dirty.
- **`--output=json` tools still warn on stdout** sometimes; look once.
