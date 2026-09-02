# Terraform's external data source got "INFO starting" instead of JSON

## Briefing

`external.py` is used as `data "external" "inventory"` or as an Ansible
`action` plugin, or as a GitHub Actions JS wrapper's cousin: **the only
thing allowed on stdout is one JSON object**. The script logs with
`print("starting")`. Terraform fails with `Unexpected extra characters`
/ `jq: parse error`. The same class of bug as python-09/11, but the
consumer is a **protocol**: terraform external, `kubectl` exec JSON,
Ansible module JSON.

Operators "fix" it by `2>/dev/null` and lose the error. The right fix is
logs on stderr, one `json.dump` on stdout, and non-zero exit with JSON
`{"error": "..."}` or empty stdout per the tool's contract.

## Your Task

- Run the script the way Terraform does (`stdout` captured) and show
  JSON parse failing.
- Move logs to stderr; emit only `{"hosts": [...]}` on stdout.
- On failure, exit 1 and print the error on stderr (Terraform shows it);
  do not print a second JSON mixed with a stack trace on stdout.

## Starter Files

### file: external.py

```python
#!/usr/bin/env python3
import json
import sys


def main():
    print("INFO starting inventory")
    hosts = ["web-01", "web-02"]
    print(json.dumps({"hosts": ",".join(hosts)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 external.py | jq .
# parse error: Invalid numeric literal at line 1, column 4
# INFO starting inventory
# {"hosts":"web-01,web-02"}
```

Terraform:

```
Error: command "python3" produced invalid JSON: Unexpected extra characters
```

The data source is unusable. The inventory itself was fine.

## Expected Outcome

```bash
python3 external.py 2>external.log | jq .
# {
#   "hosts": "web-01,web-02"
# }
cat external.log
# INFO starting inventory
```

Terraform `data.external.inventory.result.hosts` is `web-01,web-02`.
(Note: terraform external values must be **map of string**, not nested
lists — another protocol trap; keep values as strings if you are in that
tool.)

## Hints

### Hint 1 — The protocol is stdout

Terraform external: stdout = JSON object of strings. Ansible modules:
JSON on stdout. `print` is a protocol violation. `logging` to stderr.

### Hint 2 — Nested types

`{"hosts": ["web-01"]}` is valid JSON and **invalid** terraform external
output. The drill's join-to-comma is ugly on purpose — match the
consumer, or do not use `external`.

## Solution

```python
import logging
logging.basicConfig(stream=sys.stderr, level=logging.INFO)
log = logging.getLogger("inventory")

def main():
    log.info("starting inventory")
    json.dump({"hosts": "web-01,web-02"}, sys.stdout)
    sys.stdout.write("\n")
    return 0
```

- **If a machine parses stdout, humans cannot share it.**
- **Terraform external is stringly-typed JSON.** Lists/objects-as-values
  fail in a different way than a log line does.
- **Exit non-zero on failure**; Terraform will surface stderr.
- **python-09/11** are the same discipline without a named protocol.
