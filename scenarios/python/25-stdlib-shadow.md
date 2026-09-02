# The deploy script imported json and got our helper instead of the stdlib

## Briefing

`deploy.py` lives in `/opt/deploy` next to a convenience module the team
named `json.py` ("we just dump pretty JSON"). On the laptop, you run
from another directory and Python finds the stdlib. On the server,
systemd `WorkingDirectory=/opt/deploy` puts `''` (cwd) first on
`sys.path`. `import json` loads the helper. It does not have `loads`.
The unit fails with `AttributeError: module 'json' has no attribute 'loads'`.
The helper itself is fine — its name is not.

Same incident with `email.py`, `cmd.py`, `test.py`, `http.py`, `logging.py`
dropped "temporarily" in the job directory.

## Your Task

- Put a local `json.py` next to the script, run from that directory, and
  show the stdlib being shadowed.
- Rename the helper (or stop relying on cwd on `sys.path`).
- Prove `json.loads` works when cwd is the project dir.

## Starter Files

### file: json.py

```python
# team helper — name collides with the stdlib
def pretty(obj):
    return repr(obj)
```

### file: deploy.py

```python
#!/usr/bin/env python3
import json
import sys


def main():
    payload = json.loads('{"env": "prod"}')
    print("deploying to", payload["env"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 deploy.py
# Traceback:
#   payload = json.loads('{"env": "prod"}')
# AttributeError: module 'json' has no attribute 'loads'
python3 -c "import json, inspect; print(json.__file__)"
# .../json.py     (the helper, if you ran from this dir)
```

From another directory with the script by path, it may work — which is
why "works on my machine" survived code review.

## Expected Outcome

```bash
python3 deploy.py
# deploying to prod
python3 -c "import json; print(json.dumps({'ok': True}))"
# {"ok": true}
```

The helper is `prettyjson.py` / `deploy_json.py`. `sys.path` is not
depending on cwd for production.

## Hints

### Hint 1 — Print json.__file__

If it is not inside the interpreter's `lib/python3.x/json/`, you are
shadowed. `python3 -c "import json; print(json.__file__)"` from the
WorkingDirectory is the diagnosis.

### Hint 2 — Do not name files after stdlib or site-packages

`json.py`, `email.py`, `logging.py`, `uuid.py`, `argparse.py`, `test.py`.
Packaging (`pip install .`) plus `python -m deploy` also beats `cd` +
`import`.

## Solution

Rename `json.py` to `prettyjson.py`. If you must keep a local package,
run as `python3 -m deploy` from a parent that is not shadowing, or set
`PYTHONSAFEPATH` (3.11+) / don't put `''` first.

```bash
mv json.py prettyjson.py
# systemd: ExecStart=/opt/deploy/.venv/bin/python -m deploy
```

- **Cwd on sys.path is why systemd WorkingDirectory changes imports.**
- **AttributeError on a stdlib function** is often a name collision, not
  a missing pip package (python-02).
- **`json.__file__` is the first question.**
- **Never ship `test.py` next to the job** — `import test` is the stdlib
  `test` package on some layouts and your file on others.
