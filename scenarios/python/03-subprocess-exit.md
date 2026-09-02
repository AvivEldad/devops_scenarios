# The automation that reports success after failing

## Briefing

`deploy.py` wraps three steps: run the database migration, roll out the new version,
and warm the cache. Last Thursday the migration failed. The script printed
`DEPLOY COMPLETE`, exited `0`, the pipeline went green, and the new application
version was rolled out against a schema that had not been migrated.

Nobody was lied to by a person. They were lied to by an exit code.

The script has five defects, and every one of them is common enough that you will
meet it in a real codebase this year.

## Your Task

Save the starter files and make the wrapper trustworthy.

1. Run it and observe it reporting success while a step fails.
2. Find all five defects.
3. Rewrite it so that any step failing stops the deploy, surfaces the real error, and
   produces a non-zero exit code.

Do not modify the three step scripts. They are stand-ins for real tools and their
behaviour is what you must handle correctly.

```bash
mkdir -p ~/breakfix/python-03 && cd ~/breakfix/python-03
```

## Starter Files

### file: steps/migrate.sh

```bash
#!/usr/bin/env bash
# Simulates a failing database migration.
echo "applying migration 0042_add_index"
echo "ERROR: relation \"orders\" does not exist" >&2
exit 1
```

### file: steps/rollout.sh

```bash
#!/usr/bin/env bash
echo "rolling out version ${VERSION:-unknown}"
sleep 1
echo "rollout complete"
exit 0
```

### file: steps/warm-cache.sh

```bash
#!/usr/bin/env bash
# Simulates a step that hangs forever.
echo "warming cache"
sleep 600
echo "cache warm"
```

### file: deploy.py

```python
#!/usr/bin/env python3
import os
import subprocess
import sys


def run(cmd):
    print(">> %s" % cmd)
    output = subprocess.run(cmd, shell=True, capture_output=True)
    return output.stdout.decode()


def main():
    version = sys.argv[1] if len(sys.argv) > 1 else "latest"

    print(run("bash steps/migrate.sh"))
    print(run("VERSION=%s bash steps/rollout.sh" % version))
    print(run("bash steps/warm-cache.sh"))

    print("DEPLOY COMPLETE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
chmod +x steps/*.sh
python3 deploy.py v2.1.0; echo "exit=$?"
```

```
>> bash steps/migrate.sh
applying migration 0042_add_index

>> VERSION=v2.1.0 bash steps/rollout.sh
rolling out version v2.1.0
rollout complete

>> bash steps/warm-cache.sh
                                     <- hangs here for ten minutes
DEPLOY COMPLETE
exit=0
```

Three things to notice, in increasing order of seriousness:

- The migration's error message is **gone**. It was written to stderr, which the
  script captured and discarded.
- The migration **failed** and the rollout ran anyway.
- The script exited `0`, so every system downstream believes the deploy succeeded.

The hang is the least dangerous defect here, because at least somebody eventually
notices it.

## Expected Outcome

The wrapper must stop at the first failure and tell the truth about it.

A failing step aborts the deploy with a non-zero exit code:

```bash
python3 deploy.py v2.1.0; echo "exit=$?"
```

```
>> migrate
applying migration 0042_add_index
ERROR: relation "orders" does not exist

error: step 'migrate' failed with exit code 1
exit=1
```

The later steps did not run:

```bash
python3 deploy.py v2.1.0 2>&1 | grep -c "rolling out"
# 0
```

The stderr from the failing step is visible, not swallowed:

```bash
python3 deploy.py v2.1.0 2>&1 | grep -c 'relation "orders" does not exist'
# 1
```

A hanging step is killed rather than blocking forever. Make the migration succeed to
reach it:

```bash
sed -i 's/^exit 1$/exit 0/' steps/migrate.sh
time python3 deploy.py v2.1.0; echo "exit=$?"
```

```
error: step 'warm-cache' timed out after 30s
exit=1
```

and it must return in roughly the timeout, not in ten minutes.

The happy path still works:

```bash
sed -i 's/^sleep 600$/sleep 1/' steps/warm-cache.sh
python3 deploy.py v2.1.0; echo "exit=$?"
# DEPLOY COMPLETE
# exit=0
```

And the version argument reaches the step without being interpolated into a shell
string:

```bash
python3 deploy.py 'v2.1.0; echo pwned' 2>&1 | grep -c pwned
# 0        -- the argument is data, never code
```

## Hints

### Hint 1 — subprocess.run does not raise on failure

`subprocess.run()` returns a `CompletedProcess` whatever happens. A non-zero exit is
not an exception; it is a value in `.returncode` that this script never reads.

Two ways to fix it:

```python
result = subprocess.run(cmd, ...)
if result.returncode != 0:
    ...

# or let Python raise
subprocess.run(cmd, check=True)   # raises CalledProcessError on non-zero
```

`check=True` is the safer default for automation, because forgetting to check a
return value fails silently while forgetting to catch an exception fails loudly.

### Hint 2 — capture_output discards stderr unless you print it

`capture_output=True` redirects both streams into the result object. The script
returns only `stdout`, so the migration's actual error message is collected and
thrown away — which is why the log shows a step doing nothing rather than a step
failing.

If you do not need to inspect the output programmatically, the simplest correct thing
is to not capture at all and let the child write straight to your stdout and stderr.
If you do capture, you must print both streams yourself.

### Hint 3 — shell=True is both a hazard and unnecessary

```python
subprocess.run("VERSION=%s bash steps/rollout.sh" % version, shell=True)
```

The version string is interpolated into a shell command line, so
`v1.0; rm -rf /tmp/x` executes a second command. In CI, that string often comes from
a branch name or a webhook payload.

Pass an argument list instead, and set environment variables through the `env`
parameter rather than shell syntax:

```python
subprocess.run(["bash", "steps/rollout.sh"], env={**os.environ, "VERSION": version})
```

With a list and no shell, the argument can never be parsed as code.

### Hint 4 — Every external call needs a timeout

`subprocess.run(..., timeout=30)` raises `subprocess.TimeoutExpired` and kills the
child. Without it, one wedged command blocks the pipeline until a human intervenes,
holding a runner and often a deployment lock.

Choose the timeout per step. A migration may legitimately take minutes; a cache warm
should not.

### Hint 5 — Exit codes are the contract

Whatever the script prints, the number it returns is what CI acts on. Propagate
failure and give the caller something to distinguish causes: `0` success, `1` a step
failed, `2` bad usage. Print diagnostics to `sys.stderr` so a caller that parses your
stdout is not corrupted by error text.

## Solution

Five defects: the return code is ignored, stderr is discarded, `shell=True` with
string interpolation, no timeout, and a hard-coded `return 0`.

```python
#!/usr/bin/env python3
"""Run deployment steps in order, stopping at the first failure."""
import os
import subprocess
import sys

# name, argv, timeout in seconds
STEPS = [
    ("migrate",    ["bash", "steps/migrate.sh"],    300),
    ("rollout",    ["bash", "steps/rollout.sh"],    600),
    ("warm-cache", ["bash", "steps/warm-cache.sh"],  30),
]


class StepError(Exception):
    pass


def run_step(name, argv, timeout, env):
    print(">> %s" % name, flush=True)
    try:
        # no capture: the child writes straight to our stdout/stderr, so output
        # is interleaved correctly and nothing is silently swallowed
        subprocess.run(argv, env=env, timeout=timeout, check=True)
    except subprocess.CalledProcessError as exc:
        raise StepError("step %r failed with exit code %d" % (name, exc.returncode))
    except subprocess.TimeoutExpired:
        raise StepError("step %r timed out after %ds" % (name, timeout))
    except FileNotFoundError:
        raise StepError("step %r: executable not found: %s" % (name, argv[0]))


def main(argv):
    if len(argv) != 2:
        print("usage: deploy.py <version>", file=sys.stderr)
        return 2

    version = argv[1]
    env = {**os.environ, "VERSION": version}

    for name, cmd, timeout in STEPS:
        try:
            run_step(name, cmd, timeout, env)
        except StepError as exc:
            print("\nerror: %s" % exc, file=sys.stderr)
            print("deploy aborted; later steps did not run", file=sys.stderr)
            return 1

    print("DEPLOY COMPLETE")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

Verify each behaviour:

```bash
python3 deploy.py v2.1.0; echo "exit=$?"                    # stops at migrate, exit 1
python3 deploy.py 'v1; echo pwned' 2>&1 | grep -c pwned     # 0
```

The reasoning behind the choices:

- **Not capturing output** is deliberate. Capturing is right when you need to parse
  the result, but then you are responsible for printing both streams on failure — and
  you also lose live progress output, which matters for a step that runs for minutes.
  If you do capture, use `text=True` and print `exc.stdout` and `exc.stderr` in the
  handler.
- **A list argv with no shell** removes the injection class entirely. Reach for
  `shell=True` only when you genuinely need shell features like pipes or globbing,
  and then build the string with `shlex.quote()`.
- **Per-step timeouts** acknowledge that steps have different legitimate durations.
  A single global timeout is either too short for migrations or too long to be useful.
- **A step table** makes the sequence data rather than code, so adding a step cannot
  accidentally skip the error handling.

What this deliberately does *not* solve is the harder half of the problem: the
migration failed after the rollout had already run in the original code, and in a
real system that leaves you mid-deploy. Stopping early limits the damage, but genuine
safety needs steps that are idempotent and a defined rollback for each one. Worth
knowing that ordering alone is not atomicity.

## What You Learned

A wrapper script inherits enormous trust — CI, dashboards and humans all believe its
exit code — and this one had none of the machinery required to earn it. Each
individual defect looks minor in review, which is exactly why they accumulate.

The rule to internalise for anything that shells out: check the return code or use
`check=True`, never discard stderr, never interpolate variables into a shell string,
always set a timeout, and make sure your own exit code reflects what actually
happened. Silent success is the worst possible failure mode in automation, because
every safeguard downstream is waiting for a signal that never comes.
