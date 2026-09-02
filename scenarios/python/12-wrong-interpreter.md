# ./cleanup.py dies on the jump host and runs on your laptop

## Briefing

The shebang is `#!/usr/bin/env python`. On your laptop `python` is 3.11.
On the jump host `python` is missing, or is 2.7, or is a distro stub that
says "use python3". The same file run as `python3 cleanup.py` works.
Operations still invoke `./cleanup.py` because the runbook says the
script is executable.

Python-02 is "which *packages*". This is "which *binary*" — shebang,
`env`, and the fact that Debian/RHEL have not agreed on `python` in
years.

## Your Task

- Show the shebang resolving to the wrong (or missing) interpreter.
- Use `#!/usr/bin/env python3`, keep the executable bit, and prove
  `./cleanup.py` runs as 3.x on a PATH that has `python3`.
- Print `sys.version` at startup so the next jump host is diagnosable.

## Starter Files

### file: cleanup.py

```python
#!/usr/bin/env python
import sys

# f-strings and pathlib-style hints: Python 3 only
def main():
    name = "jump-host"
    print("cleaning " + name)
    print("hello from", sys.version)
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
# typical jump host
./cleanup.py
# /usr/bin/env: ‘python’: No such file or directory

# or Python 2:
# File "cleanup.py", line 6
#   def main():
# SyntaxError: invalid syntax   (if you had used f"{name}")
```

`python3 cleanup.py` works. The runbook does not say that.

## Expected Outcome

```bash
head -1 cleanup.py
# #!/usr/bin/env python3

chmod +x cleanup.py
./cleanup.py
# cleaning jump-host
# hello from 3.11.x ...
```

A missing `python3` fails immediately with `env: python3: No such file`,
which is the right error.

## Hints

### Hint 1 — env python vs env python3

`/usr/bin/env python3` is the portable ops shebang. `#!/usr/bin/python3`
is fine on a distro you pin. `#!/usr/bin/env python` is a laptop-ism.

### Hint 2 — The kernel reads the shebang, not bash

`chmod +x` plus `./script` uses the shebang. `python3 script.py` ignores
it. Test the invocation the runbook actually uses, including systemd
`ExecStart=/opt/cleanup.py`.

## Solution

```python
#!/usr/bin/env python3
```

```bash
chmod +x cleanup.py
# in systemd: ExecStart=/opt/venv/bin/python /opt/cleanup.py
# the venv's python is even better than env python3
```

- **`python` is not a stable name.** `python3` is.
- **Shebang is the production interpreter** when the unit/cron calls
  `./script`.
- **venv `bin/python`** (python-02) plus an explicit ExecStart beats
  `env` on hosts with several versions.
- **Log `sys.version` once** at process start in long-running workers.
