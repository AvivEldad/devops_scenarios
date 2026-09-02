# The rendered nginx config has `server_name ;` and nginx still started

## Briefing

A tiny renderer (the in-house "helm") substitutes `{{hostname}}` in a
systemd unit or nginx vhost. The CI job forgot to pass `hostname`. The
engine replaced the placeholder with **empty string**, wrote a config
that nginx accepted, and the site answered on the default vhost for the
wrong tenant.

Jinja2's default `Undefined` is silent. Home-grown regex templates are
worse. Missing values must be errors, not blank YAML/nginx.

## Your Task

- Render with a missing key and show the hole in the output.
- Make unknown placeholders fail the job (non-zero, no file written).
- Render successfully when every key is present.

## Starter Files

### file: vhost.conf.tmpl

```
server {
    listen 80;
    server_name {{hostname}};
    root /var/www/{{app}};
}
```

### file: render.py

```python
#!/usr/bin/env python3
import re
import sys


def render(text, **values):
    def repl(match):
        key = match.group(1)
        return str(values.get(key, ""))     # silent

    return re.sub(r"\{\{\s*(\w+)\s*\}\}", repl, text)


def main():
    tmpl = open("vhost.conf.tmpl").read()
    # CI forgot hostname
    out = render(tmpl, app="reports")
    open("vhost.conf", "w").write(out)
    print("wrote vhost.conf")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 render.py
# wrote vhost.conf
# server {
#     listen 80;
#     server_name ;
#     root /var/www/reports;
# }
```

nginx will load this. Traffic hits the default server. Exit code 0.

## Expected Outcome

```bash
python3 render.py; echo exit=$?
# error: missing template keys: hostname
# exit=1
ls vhost.conf
# (not written, or previous good file left in place)

python3 -c 'import runpy'  # instead:
# pass hostname=reports.internal app=reports
# server_name reports.internal;
```

A leftover `{{` in the output is also a failure.

## Hints

### Hint 1 — .get(key, "") is the bug

`values[key]` or a collected `missing` list. Do not default placeholders
to empty. In Jinja2: `Environment(undefined=StrictUndefined)`.

### Hint 2 — Write only after validation

Render to a string, reject if missing keys or if `{{` remains, then write
(atomically if you can). A half-written nginx file is a reload outage.

## Solution

```python
def render(text, **values):
    missing = []

    def repl(match):
        key = match.group(1)
        if key not in values:
            missing.append(key)
            return match.group(0)
        return str(values[key])

    out = re.sub(r"\{\{\s*(\w+)\s*\}\}", repl, text)
    if missing:
        raise KeyError("missing template keys: %s" % ", ".join(sorted(set(missing))))
    return out
```

Jinja2: `from jinja2 import Environment, StrictUndefined, FileSystemLoader`.

- **Empty `server_name` / empty image tag is a successful render** only
  if you allow it. Do not.
- **StrictUndefined** (Jinja) / **mustache throw on missing** / your own
  KeyError — pick one and use it in CI.
- **Do not commit rendered files that still contain `{{`.**
- **Ansible `{{ var }}` with skip-undefined** is the same class of bug.
