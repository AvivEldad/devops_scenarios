# KeyError at 3 a.m.

## Briefing

The on-call engineer was paged because a deploy failed. This is the entire error they
had to work with:

```
Traceback (most recent call last):
  File "/opt/deploy/release.py", line 12, in <module>
    main()
  File "/opt/deploy/release.py", line 8, in main
    token = os.environ["DEPLOY_TOKEN"]
  File "/usr/lib/python3.11/os.py", line 679, in __getitem__
    raise KeyError(key) from None
KeyError: 'DEPLOY_TOKEN'
```

It took forty minutes to work out that a variable had been renamed in the CI settings.
The information needed to fix it in thirty seconds was available to the script the
moment it started.

## Your Task

Save the starter script and make it fail *well*.

1. Run it with no environment set and see the bare traceback.
2. Rewrite the configuration handling so that a missing or invalid variable produces
   an actionable message, not a stack trace.
3. Keep the working behaviour identical when the environment is correct.

Specifically, the script must report **every** configuration problem at once rather
than one per run, exit with status `2` for a configuration error, and never print the
token value.

```bash
mkdir -p ~/breakfix/python-01 && cd ~/breakfix/python-01
```

## Starter Files

### file: release.py

```python
#!/usr/bin/env python3
import os
import sys


def main():
    token = os.environ["DEPLOY_TOKEN"]
    env = os.environ["DEPLOY_ENV"]
    replicas = int(os.environ["REPLICAS"])
    timeout = float(os.environ.get("TIMEOUT_SECONDS"))

    print("deploying to %s with %d replicas (timeout %.1fs)" % (env, replicas, timeout))
    print("using token ending in %s" % token[-4:])
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 release.py
```

```
Traceback (most recent call last):
  ...
KeyError: 'DEPLOY_TOKEN'
```

Set that one variable and it fails again, one variable later:

```bash
DEPLOY_TOKEN=abc123456789 python3 release.py
# KeyError: 'DEPLOY_ENV'
```

Keep going and you discover more traps:

```bash
DEPLOY_TOKEN=abc123456789 DEPLOY_ENV=prod REPLICAS=three python3 release.py
# ValueError: invalid literal for int() with base 10: 'three'

DEPLOY_TOKEN=abc123456789 DEPLOY_ENV=prod REPLICAS=3 python3 release.py
# TypeError: float() argument must be a string or a real number, not 'NoneType'
```

Four runs, four tracebacks, one variable discovered at a time. Note the last one:
`os.environ.get()` returns `None` rather than raising, so the failure surfaces later
and further from the cause — that is strictly worse than the `KeyError`.

## Expected Outcome

A missing configuration produces a complete, readable report and exit code `2`:

```bash
python3 release.py; echo "exit=$?"
```

```
error: invalid configuration

  DEPLOY_TOKEN      missing (required)  - API token used to authenticate the deploy
  DEPLOY_ENV        missing (required)  - target environment: dev, staging or prod
  REPLICAS          missing (required)  - number of replicas, positive integer
  TIMEOUT_SECONDS   using default 30.0

set the missing variables and run again
exit=2
```

Invalid values are reported with what was actually received:

```bash
DEPLOY_TOKEN=abc123456789 DEPLOY_ENV=production REPLICAS=three python3 release.py; echo "exit=$?"
```

```
error: invalid configuration

  DEPLOY_ENV        invalid: 'production'  - must be one of: dev, staging, prod
  REPLICAS          invalid: 'three'       - must be a positive integer

exit=2
```

The happy path is unchanged and exits `0`:

```bash
DEPLOY_TOKEN=abc123456789 DEPLOY_ENV=prod REPLICAS=3 python3 release.py; echo "exit=$?"
# deploying to prod with 3 replicas (timeout 30.0s)
# using token ending in 6789
# exit=0
```

The secret is never printed in full, including in error paths:

```bash
DEPLOY_TOKEN=supersecrettoken DEPLOY_ENV=nope REPLICAS=3 python3 release.py 2>&1 \
  | grep -c supersecrettoken
# 0
```

And distinct exit codes distinguish the two kinds of failure:

```bash
# 0 = success, 2 = configuration error, 1 = deployment failure
```

## Hints

### Hint 1 — Collect errors, do not raise on the first one

The reason on-call had to run it four times is that the script stops at the first
problem. Validate everything into a list, then report the list:

```python
errors = []
if not token:
    errors.append("DEPLOY_TOKEN  missing (required)")
...
if errors:
    print("error: invalid configuration\n", file=sys.stderr)
    for e in errors:
        print("  " + e, file=sys.stderr)
    sys.exit(2)
```

This one change is most of the value. It turns four debugging cycles into one.

### Hint 2 — Errors belong on stderr, and exit codes carry meaning

Diagnostics go to `sys.stderr`, not `print()` to stdout, so that a caller piping your
output is not corrupted by error text.

Give configuration failures their own exit code. A CI job or wrapper script can then
distinguish "the operator misconfigured this" (retrying will not help, exit 2) from
"the deployment itself failed" (might be transient, exit 1). Reserve `0` strictly for
success.

### Hint 3 — Validate the value, not just the presence

`REPLICAS=three` is present and useless. Parse and range-check inside a `try`, and
report the offending value in the message. `DEPLOY_ENV=production` is a real example
of a value that looks right and is not in the allowed set — say what the allowed set
is, because that is the information the reader needs.

### Hint 4 — Never log the secret

`token[-4:]` is a good pattern for confirming *which* credential is in use without
exposing it. Make sure no error path prints the whole value, and be careful with
`repr()` of a config object or `print(vars())`, which are common accidental leaks.
Consider asserting a minimum length so an empty or truncated token is caught early.

## Solution

The rewritten script separates configuration loading from the work, and treats
configuration as something to validate rather than something to index into.

```python
#!/usr/bin/env python3
"""Deploy a release. Configuration comes from the environment."""
import os
import sys
from dataclasses import dataclass

VALID_ENVS = ("dev", "staging", "prod")
DEFAULT_TIMEOUT = 30.0


@dataclass
class Config:
    token: str
    env: str
    replicas: int
    timeout: float


def load_config(environ):
    """Return (config, errors). Never raises for bad input."""
    errors = []

    token = environ.get("DEPLOY_TOKEN", "").strip()
    if not token:
        errors.append(("DEPLOY_TOKEN", "missing (required)",
                       "API token used to authenticate the deploy"))
    elif len(token) < 8:
        errors.append(("DEPLOY_TOKEN", "invalid: too short",
                       "expected at least 8 characters"))

    env = environ.get("DEPLOY_ENV", "").strip()
    if not env:
        errors.append(("DEPLOY_ENV", "missing (required)",
                       "target environment: " + ", ".join(VALID_ENVS)))
    elif env not in VALID_ENVS:
        errors.append(("DEPLOY_ENV", "invalid: %r" % env,
                       "must be one of: " + ", ".join(VALID_ENVS)))

    raw_replicas = environ.get("REPLICAS", "").strip()
    replicas = None
    if not raw_replicas:
        errors.append(("REPLICAS", "missing (required)",
                       "number of replicas, positive integer"))
    else:
        try:
            replicas = int(raw_replicas)
            if replicas < 1:
                raise ValueError
        except ValueError:
            errors.append(("REPLICAS", "invalid: %r" % raw_replicas,
                           "must be a positive integer"))

    raw_timeout = environ.get("TIMEOUT_SECONDS", "").strip()
    timeout = DEFAULT_TIMEOUT
    if raw_timeout:
        try:
            timeout = float(raw_timeout)
            if timeout <= 0:
                raise ValueError
        except ValueError:
            errors.append(("TIMEOUT_SECONDS", "invalid: %r" % raw_timeout,
                           "must be a positive number of seconds"))

    if errors:
        return None, errors
    return Config(token=token, env=env, replicas=replicas, timeout=timeout), []


def report(errors):
    print("error: invalid configuration\n", file=sys.stderr)
    width = max(len(name) for name, _, _ in errors)
    for name, problem, help_text in errors:
        print("  %-*s  %-22s - %s" % (width, name, problem, help_text), file=sys.stderr)
    print("\nset the missing variables and run again", file=sys.stderr)


def deploy(cfg):
    print("deploying to %s with %d replicas (timeout %.1fs)"
          % (cfg.env, cfg.replicas, cfg.timeout))
    print("using token ending in %s" % cfg.token[-4:])
    return 0


def main():
    cfg, errors = load_config(os.environ)
    if errors:
        report(errors)
        return 2          # configuration error
    return deploy(cfg)    # 0 on success, 1 on deployment failure


if __name__ == "__main__":
    sys.exit(main())
```

Why the structure matters as much as the messages:

- **`load_config(environ)` takes the environment as an argument** instead of reading
  the global. That makes it testable — you can call
  `load_config({"DEPLOY_ENV": "nope"})` in a unit test with no monkeypatching.
- **It returns errors rather than raising**, which is what allows every problem to be
  collected and reported together.
- **Configuration is validated once, up front.** The alternative, discovering a bad
  value halfway through a deploy, leaves the system in a partial state. Fail before
  you touch anything.

For larger tools, `pydantic-settings` or `environs` give you this with declarative
schemas. The reasoning is identical; they just remove the boilerplate.

## What You Learned

A traceback tells the reader where the program was standing when it gave up. An error
message tells them what to do. The gap between those two is most of what "operable
software" means, and it is nearly free to close — the fix here was structure, not
cleverness.

The specific habit to carry forward is validating all configuration at startup and
reporting every problem at once. Anything that gets read from the environment,
a flag, or a config file should be checked before the first side effect, because the
person reading your error output is usually tired, under pressure, and does not have
the source in front of them.
