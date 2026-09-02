# The inventory said Norway was down, and so was the node named `on`

## Briefing

The health-rollout script reads a YAML inventory. After a region rename, every host
in `NO` (Norway) is skipped. A second ticket: the canary named `on` never receives
traffic. The YAML looks fine in the editor. The parser turned `NO`, `on`, `off`,
and `yes` into booleans, then the script iterated `if name:` and dropped them.

This is the PyYAML 1.1 / Ansible / older Kubernetes gotcha, not a DNS outage.
Your parser does not have to be PyYAML — any 1.1-compatible loader will do it.

## Your Task

- Load the inventory and show which hostnames became `True`/`False`.
- Stop treating YAML 1.1 implicit booleans as hostnames (quote them, or use a
  1.2 / JSON inventory).
- Confirm Norway and the canary named `on` appear in the rollout list.

## Starter Files

### file: inventory.yaml

```yaml
hosts:
  - on          # canary
  - off         # drain target
  - NO          # Norway region code
  - web-01
  - yes         # leftover alias someone used
```

### file: rollout.py

```python
#!/usr/bin/env python3
"""Apply the same implicit-bool rules PyYAML 1.1 / Ansible use."""
import sys

YES = {"y", "yes", "true", "on"}
NO = {"n", "no", "false", "off"}


def yaml11_scalar(s):
    k = s.strip()
    low = k.lower()
    if low in YES:
        return True
    if low in NO:
        return False
    return k


def load_hosts(path):
    names = []
    in_list = False
    with open(path) as fh:
        for line in fh:
            line = line.split("#", 1)[0].rstrip()
            if line.strip() == "hosts:":
                in_list = True
                continue
            if in_list and line.strip().startswith("- "):
                names.append(yaml11_scalar(line.strip()[2:]))
    return names


def main():
    hosts = load_hosts("inventory.yaml")
    print("loaded %d hosts" % len(hosts))
    rolled = 0
    for h in hosts:
        if not h:
            continue
        print("roll %s" % h)
        rolled += 1
    print("rolled %d" % rolled)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 rollout.py
# loaded 5 hosts
# roll True          <- "on" and "yes"
# roll web-01
# rolled 2
```

`off` and `NO` became `False` and were skipped. `on`/`yes` became `True`.
The strings you wrote are gone.

## Expected Outcome

```bash
python3 rollout.py
# loaded 5 hosts
# roll on
# roll off
# roll NO
# roll web-01
# roll yes
# rolled 5
```

Quoted scalars (`"NO"`, `"on"`) or a JSON inventory survive the loader.

## Hints

### Hint 1 — YAML 1.1 booleans are a long list

`y`, `n`, `yes`, `no`, `true`, `false`, `on`, `off`, and the country code `NO`
are booleans unless quoted. Print `repr(h)` after parse, not just `print(h)`.

### Hint 2 — Quote, or leave YAML 1.1

In the file: `- "NO"`. In PyYAML 5.1+: `yaml.load(..., Loader=yaml.SafeLoader)`
still does this; YAML 1.2 libraries and JSON do not. Ansible inventories quote
anything that looks like a word.

## Solution

Treat hostnames as strings. Quote them at rest, and never use `if hostname:` as
a presence check after a 1.1 load.

```python
# quote in YAML, or:
def yaml11_scalar(s):
    return s.strip()          # do not coerce

# with PyYAML, still quote; SafeLoader is not YAML 1.2
# json.load of ["on","NO","web-01"] never has this bug
```

- **Inventory is data, not YAML types.** Region codes and node names collide
  with 1.1 booleans constantly.
- **`if name:` drops `False`.** That is how Norway disappeared.
- **`repr()` in debug prints** would have shown `True` instead of `on`.
- **Prefer JSON or quoted YAML** for anything that is a name, not a flag.
