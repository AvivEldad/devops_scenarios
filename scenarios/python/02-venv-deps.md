# Works on my machine, ModuleNotFoundError in CI

## Briefing

`healthcheck.py` runs perfectly on your laptop. In the pipeline it dies immediately:

```
ModuleNotFoundError: No module named 'requests'
```

Someone adds `pip install requests` to the CI script. It passes once, then breaks a
week later with a completely different error, because the newly installed version
changed behaviour.

This is the dependency problem in miniature: the script works locally because your
machine accumulated the right packages by accident, and no file in the repository
records what it actually needs.

## Your Task

Reproduce the CI failure locally using a clean virtual environment, then make the
project reproducible.

1. Prove the failure in a fresh venv — this is the important skill, not the fix.
2. Produce a `requirements.txt` that lets the script run anywhere.
3. Make the run reproducible: the same input must install the same versions next
   month.
4. Fix the invocation so the script cannot accidentally use a different interpreter.

```bash
mkdir -p ~/breakfix/python-02 && cd ~/breakfix/python-02
```

## Starter Files

### file: healthcheck.py

```python
#!/usr/bin/env python3
"""Check that a list of endpoints is healthy."""
import sys

import requests
import yaml


def load_targets(path):
    with open(path) as fh:
        return yaml.safe_load(fh)["targets"]


def check(url, timeout=5):
    resp = requests.get(url, timeout=timeout)
    return resp.status_code, len(resp.content)


def main():
    targets = load_targets("targets.yaml")
    failures = 0
    for url in targets:
        try:
            status, size = check(url)
            ok = 200 <= status < 300
            print("%-40s %s  %d bytes" % (url, status, size))
            if not ok:
                failures += 1
        except Exception as exc:
            print("%-40s ERROR  %s" % (url, exc))
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

### file: targets.yaml

```yaml
targets:
  - https://example.com
  - https://www.iana.org/domains/reserved
```

### file: requirements.txt

```text
requests
```

### file: ci-run.sh

```bash
#!/usr/bin/env bash
# What the pipeline currently does.
set -e

pip install -r requirements.txt
python healthcheck.py
```

## Expected Failure

Recreate CI conditions with a throwaway virtual environment:

```bash
python3 -m venv /tmp/ci-venv
/tmp/ci-venv/bin/pip install -q -r requirements.txt
/tmp/ci-venv/bin/python healthcheck.py
```

```
Traceback (most recent call last):
  File "healthcheck.py", line 6, in <module>
    import yaml
ModuleNotFoundError: No module named 'yaml'
```

`requests` installs because it is listed. `yaml` does not, because nobody added it —
it was present on the developer's machine for unrelated reasons, so the import never
failed there.

There is a second, quieter fault. Run the CI script as written:

```bash
bash ci-run.sh
```

On a machine where `python` is not on `PATH` you get `python: command not found`. On
a machine where it *is*, you may get a different interpreter than the one `pip`
installed into — so packages are installed for one Python and the script runs under
another.

And a third: `requirements.txt` pins nothing, so today's install and next month's
install are different software.

## Expected Outcome

A completely fresh environment runs the script successfully.

```bash
rm -rf /tmp/verify-venv
python3 -m venv /tmp/verify-venv
/tmp/verify-venv/bin/pip install -q -r requirements.txt
/tmp/verify-venv/bin/python healthcheck.py; echo "exit=$?"
```

```
https://example.com                      200  1256 bytes
https://www.iana.org/domains/reserved    200  ... bytes
exit=0
```

Every third-party import is declared:

```bash
grep -iE '^(requests|pyyaml)' requirements.txt
# both must be present
```

Versions are pinned exactly, so installs are repeatable:

```bash
grep -c '==' requirements.txt
# equal to the number of dependency lines - no bare package names
```

Nothing needed is missing and nothing unused is listed:

```bash
/tmp/verify-venv/bin/python -c "import requests, yaml; print('imports ok')"
# imports ok
```

The CI script uses an explicit interpreter and cannot silently pick a different one:

```bash
grep -n 'python' ci-run.sh
# must reference the venv interpreter or 'python3 -m pip', not bare 'python'
```

Run the whole pipeline end to end from clean:

```bash
rm -rf .venv && bash ci-run.sh; echo "exit=$?"
# exit=0
```

## Hints

### Hint 1 — Test in a clean room, always

The only reliable way to know what a project needs is to install it somewhere that
has nothing:

```bash
python3 -m venv /tmp/clean
/tmp/clean/bin/pip install -r requirements.txt
/tmp/clean/bin/python healthcheck.py
```

Do this before every "it works on my machine" argument. It takes ten seconds and
converts an opinion into evidence.

### Hint 2 — The import name is not always the package name

The script does `import yaml`, but the package on PyPI is **PyYAML**. Similar traps:
`import cv2` is `opencv-python`, `import bs4` is `beautifulsoup4`, `import dateutil`
is `python-dateutil`, `import sklearn` is `scikit-learn`.

`pip freeze` shows distribution names, which is what belongs in the requirements file.

### Hint 3 — Do not use pip freeze blindly

`pip freeze > requirements.txt` on your laptop captures every package you ever
installed, including things this project does not use, plus transitive dependencies
mixed in with direct ones. You end up unable to tell which lines matter.

Better: list your **direct** dependencies with exact pins in `requirements.txt`, and
if you need a fully locked transitive set, generate a separate lock file with
`pip-compile` from `pip-tools` or use `uv pip compile`.

### Hint 4 — Which python is running?

`python`, `python3` and the venv's interpreter can all be different binaries with
different site-packages. The reliable pattern is to invoke pip *through* the exact
interpreter you will run:

```bash
python3 -m pip install -r requirements.txt
python3 healthcheck.py
```

`python3 -m pip` guarantees pip installs into that interpreter. In CI, prefer
creating a venv explicitly and calling `.venv/bin/python` by path so nothing depends
on `PATH` ordering or shell activation.

### Hint 5 — Pin, and know why

`requests` means "whatever version is newest at install time", so your build changes
under you. `requests==2.32.3` means the same thing every time. The trade-off is that
pins go stale and need deliberate updating — which is the point. Upgrades should be a
commit you can revert, not a surprise on a Tuesday.

## Solution

Three faults: an undeclared dependency, no version pinning, and an ambiguous
interpreter.

**Find the real dependencies** by importing in a clean venv and fixing each failure
in turn, then record the versions that worked:

```bash
python3 -m venv /tmp/clean
/tmp/clean/bin/pip install requests PyYAML
/tmp/clean/bin/pip freeze | grep -iE '^(requests|pyyaml)=='
```

### The corrected `requirements.txt`

```text
# direct dependencies, pinned for reproducible installs
requests==2.32.3
PyYAML==6.0.2
```

### The corrected `ci-run.sh`

```bash
#!/usr/bin/env bash
# Reproducible pipeline run: clean venv, pinned installs, explicit interpreter.
set -euo pipefail

VENV=".venv"
PY="$VENV/bin/python"

python3 -m venv "$VENV"
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install --quiet --require-hashes -r requirements.txt 2>/dev/null \
  || "$PY" -m pip install --quiet -r requirements.txt

"$PY" healthcheck.py
```

Verify from nothing:

```bash
rm -rf .venv
bash ci-run.sh
echo "exit=$?"
```

Points worth understanding rather than copying:

- **A virtual environment is just a directory with its own `site-packages` and its own
  `bin/python`.** "Activating" it only prepends that `bin` to `PATH`. Calling
  `.venv/bin/python` directly is equivalent and more robust in scripts, because it
  does not depend on shell state — which is why CI jobs that `source activate` in one
  step and run python in another so often break.
- **`--require-hashes`** with a hash-pinned lock file is the strongest form of
  reproducibility: it verifies the artefact contents, not just the version number,
  which protects against a re-uploaded package. Generate it with `pip-compile
  --generate-hashes`.
- **Layer your pins.** Direct dependencies with intent in `requirements.in`,
  fully-resolved transitive versions in a generated `requirements.txt`. You then know
  which upgrades were decisions and which were consequences.
- **Cache the wheels, not the venv**, in CI. Caching a venv across runs reintroduces
  exactly the "accumulated state" problem you are trying to eliminate.

## What You Learned

The bug was never in the code. It was that the repository did not describe its own
requirements, and the developer's machine had quietly compensated for years.

The habit worth building is reflexive: before claiming something works, install it
into an empty virtual environment and run it there. Every "works on my machine"
dispute is settled in ten seconds by that command, and doing it routinely means you
find undeclared dependencies while you are writing the code rather than when the
pipeline finds them for you.
