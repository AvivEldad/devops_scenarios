# The "Python config" from the other team deleted the working directory

## Briefing

`load_settings.py` needs a nested config, and someone decided YAML was a
fuss, so the file is `settings.py` and the loader does `eval(open(...).read())`
or `exec`. It worked while the file was a dict literal. A merge request
added a helper at the top of the file — "just a little Python" — and a
copy-paste from a wiki included `os.system`. The deploy user ran the
loader. The config is not data anymore; it is code.

This is the same family as `yaml.load` without SafeLoader and `pickle`
of an inventory cache. The DevOps rule: **config is data**.

## Your Task

- Run the loader against the provided settings file and observe a side
  effect (a file created outside the dict).
- Load with `ast.literal_eval` (or JSON/YAML safe_load) so only literals
  are accepted.
- Prove a real dict still loads, and that a file with `os.system` is
  rejected.

## Starter Files

### file: settings.py

```python
{"region": "eu-west-1", "replicas": 3}
```

### file: settings.evil.py

```python
(__import__("pathlib").Path("pwned.txt").write_text("eval ran code\n"), {"region": "eu-west-1"})[1]
```

### file: load_settings.py

```python
#!/usr/bin/env python3
import sys


def load(path):
    return eval(open(path).read())     # noqa: S307 — the incident


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "settings.py"
    cfg = load(path)
    print("region=%s replicas=%s" % (cfg["region"], cfg.get("replicas")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 load_settings.py settings.py
# region=eu-west-1 replicas=3

python3 load_settings.py settings.evil.py
# region=eu-west-1 replicas=None
ls pwned.txt
# pwned.txt
```

The process printed a normal config and still executed arbitrary code.

## Expected Outcome

```bash
python3 load_settings.py settings.py
# region=eu-west-1 replicas=3

python3 load_settings.py settings.evil.py; echo exit=$?
# error: settings is not a literal dict (ValueError: malformed node ...)
# exit=1
test ! -f pwned.txt
```

## Hints

### Hint 1 — eval is Python, not a parser

`ast.literal_eval` accepts dicts, lists, strings, numbers, bools, None.
It will not call `__import__`. JSON is even stricter and is what you
should store.

### Hint 2 — yaml.load is the cousin

`yaml.load(f)` without `SafeLoader` can construct Python objects from
`!!python/object`. `yaml.safe_load` is the floor. Pickle of "cached
inventory" is the same bug with a different file extension.

## Solution

```python
import ast
import json

def load(path):
    text = open(path).read()
    if path.endswith(".json"):
        return json.loads(text)
    return ast.literal_eval(text)
```

- **If it needed to be code, it is a plugin with review**, not a config
  drop on the prod box.
- **`eval` / `exec` / `yaml.load` / `pickle.loads`** of operator-supplied
  files are code execution.
- **`ast.literal_eval` is the stdlib escape hatch** for dict-shaped
  "Python config". Prefer JSON.
- **The success print does not mean the file was data.** Check side
  effects in the review of any loader.
