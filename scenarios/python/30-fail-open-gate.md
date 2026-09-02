# The security gate timed out and the pipeline shipped anyway

## Briefing

`gate.py` is the required CI check: call the scanner, fail the build if
findings are high. The scanner was slow. Someone wrapped the call in
`try/except Exception: return 0` because "we should not block deploys
when the scanner is down." It shipped a critical CVE. The GitHub check
stayed green. This is **fail-open** policy as a Python `except`.

Python-03 is a wrapper that ignores a subprocess exit code by accident.
This is a wrapper that ignores it **on purpose**, in the exception path,
and looks like resilience. Change-control for a security gate is
fail-closed: if you cannot prove the scan ran, you do not deploy.

## Your Task

- Run the gate against a down scanner and show exit 0.
- Fail closed: timeout/connection/5xx → exit 2 (or 1), distinct from
  "scan ran, findings found" (exit 1).
- Only exit 0 when you received a 2xx JSON body and evaluated it.

## Starter Files

### file: gate.py

```python
#!/usr/bin/env python3
import json
import sys
from urllib.error import URLError
from urllib.request import urlopen

SCANNER = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18087/scan"


def main():
    try:
        with urlopen(SCANNER, timeout=2) as resp:
            data = json.loads(resp.read().decode())
    except Exception as exc:
        print("scanner unavailable (%s) — allowing deploy" % exc)
        return 0
    highs = [f for f in data.get("findings", []) if f.get("severity") == "high"]
    if highs:
        print("blocked: %d high findings" % len(highs))
        return 1
    print("scan clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 gate.py; echo exit=$?
# scanner unavailable (urlopen error [Errno 111] Connection refused) — allowing deploy
# exit=0
```

The required check did not run. The pipeline treated that as a pass.

## Expected Outcome

```bash
python3 gate.py; echo exit=$?
# error: scanner unreachable: Connection refused
# error: fail-closed — not deploying
# exit=2

# when the scanner is up with a high finding:
# blocked: 1 high findings
# exit=1

# when the scanner is up and clean:
# scan clean
# exit=0
```

A documented break-glass (`GATE_ALLOW_UNSCANNED=1` plus a loud log and
an audit line) may exist; it is not the default `except`.

## Hints

### Hint 1 — Three outcomes, three codes

0 = scan ran, policy pass. 1 = scan ran, policy fail. 2 = scan did not
run. Branch protection / Jenkins `unstable` can treat 2 as block.

### Hint 2 — except Exception is fail-open

Narrow to `HTTPError`/`URLError`/`TimeoutError`/`json.JSONDecodeError`
and still return 2. A JSON parse error is not "no findings".

## Solution

```python
try:
    with urlopen(SCANNER, timeout=2) as resp:
        if resp.status != 200:
            print("error: scanner HTTP %s" % resp.status, file=sys.stderr)
            return 2
        data = json.loads(resp.read().decode())
except (URLError, TimeoutError, json.JSONDecodeError) as exc:
    print("error: scanner unreachable: %s" % exc, file=sys.stderr)
    print("error: fail-closed — not deploying", file=sys.stderr)
    return 2
```

- **Unavailable control plane ≠ allow.** That is fail-open.
- **Exit codes are the policy.** Green check + `except: return 0` is how
  CVEs ship.
- **Break-glass must be explicit** (env, two-person flag), logged, and
  ticketed — not an exception handler.
- **Same pattern:** license scanners, SBOM, "did terraform plan have
  destroys?", "is the change freeze on?". If the answer cannot be
  fetched, the default is stop.
