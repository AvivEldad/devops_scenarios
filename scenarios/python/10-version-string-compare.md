# The agent upgrade skipped 1.10 because 1.9 was "newer"

## Briefing

`upgrade_agent.py` reads the running version from a file (or an HTTP
endpoint) and compares it to the version in the package repo. It uses
`if current < latest:` on **strings**. After `1.9` came `1.10`, and the
fleet stopped upgrading: `"1.10" < "1.9"` is `True` in lexicographic
order, so the script decided 1.9 was already ahead.

The same class of bug bites Kubernetes `1.9` vs `1.10`, Alpine packages,
and `chart-1.2` vs `chart-1.10`. DevOps version compare is not string
compare.

## Your Task

- Show `"1.10" < "1.9"` and the script skipping the upgrade.
- Compare as tuples of integers (or `packaging.version` if you already
  depend on it).
- Confirm 1.9 upgrades to 1.10 and 1.10 is left alone.

## Starter Files

### file: current-version.txt

```
1.9
```

### file: upgrade_agent.py

```python
#!/usr/bin/env python3
import sys

LATEST = "1.10"


def main():
    current = open("current-version.txt").read().strip()
    print("current=%s latest=%s" % (current, LATEST))
    if current < LATEST:
        print("upgrading %s -> %s" % (current, LATEST))
        open("current-version.txt", "w").write(LATEST + "\n")
        return 0
    print("already up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 -c 'print("1.10" < "1.9")'
# True

python3 upgrade_agent.py
# current=1.9 latest=1.10
# already up to date
```

The fleet stays on 1.9. The package repo has 1.10. Nobody is paged because
the job exits 0.

## Expected Outcome

```bash
python3 upgrade_agent.py
# current=1.9 latest=1.10
# upgrading 1.9 -> 1.10

python3 upgrade_agent.py
# current=1.10 latest=1.10
# already up to date
```

Pre-releases (`1.10rc1`) either parse correctly or are rejected, not
compared as strings.

## Hints

### Hint 1 — Split on dots, compare integers

`tuple(int(p) for p in v.split("."))` works for `1.10.2`. It explodes on
`1.10rc1` — that is a signal to use `packaging.version.Version` (already
on many systems via setuptools/pip).

### Hint 2 — The job exiting 0 is the dangerous part

A skipped upgrade that prints "already up to date" looks healthy in CI.
Log both sides of the compare as parsed tuples, not just the strings.

## Solution

```python
from functools import cmp_to_key

def parse(v):
    return tuple(int(p) for p in v.split("."))

if parse(current) < parse(LATEST):
    ...
```

Or:

```python
from packaging.version import Version
if Version(current) < Version(LATEST):
    ...
```

- **`"1.10" < "1.9"` is True.** Lexicographic order is not semver.
- **Do not pin this only in your head** — unit-test 1.9 vs 1.10 vs 1.10.1.
- **`packaging.version`** handles rc/dev; a tiny tuple parser does not.
- **An "already up to date" success** with a wrong compare is a silent
  freeze of the fleet.
