# The binary that fails silently, traced with strace

## Briefing

A program exits non-zero with no useful message, or hangs, or "does nothing". Logs are
empty, `--verbose` tells you nothing, and the source may not be available. You need to see
what it is actually doing at the system-call boundary.

`strace` shows every system call a process makes and its result — file opens, network calls,
reads, and the exact `errno` on failure. When an app swallows its errors, the failing syscall
(an `ENOENT` on a config file, `EACCES` on a socket, a hang in `read`) is right there in the
trace.

## Your Task

- Run a program that fails without explanation and reproduce the empty-handed symptom.
- Use `strace` to find the exact failing system call and its error.
- Fix the underlying cause revealed by the trace.

## Starter Files

### file: mytool.py

```python
# A tool that reads a config and dies uninformatively when something is wrong.
import sys
try:
    with open("/etc/mytool/config.ini") as f:      # this path may not exist
        data = f.read()
    # ... more work ...
    sys.exit(0)
except Exception:
    # BUG: swallows the error and exits non-zero with no message
    sys.exit(3)
```

### file: run.sh

```bash
#!/usr/bin/env bash
python3 mytool.py
echo "exit code: $?"     # you get '3' and absolutely nothing else
```

## Expected Failure

```bash
bash run.sh
# exit code: 3            <- no message, no log, no clue
```

```bash
# trace the syscalls, focus on file operations:
strace -f -e trace=openat,access,stat python3 mytool.py 2>&1 | grep -i mytool
# openat(AT_FDCWD, "/etc/mytool/config.ini", O_RDONLY) = -1 ENOENT (No such file or directory)
```

The program caught the exception and exited `3` with no output. `strace` shows the truth: the
`openat` on `/etc/mytool/config.ini` returned `-1 ENOENT` — the config file does not exist.
The failing syscall and its errno are exactly what the application refused to tell you.

## Expected Outcome

The root cause is identified from the trace and fixed.

The trace shows the once-failing call now succeeding:

```bash
strace -e trace=openat python3 mytool.py 2>&1 | grep config.ini
# openat(AT_FDCWD, "/etc/mytool/config.ini", O_RDONLY) = 3      <- success (fd 3)
```

The program exits cleanly:

```bash
python3 mytool.py; echo "exit=$?"
# exit=0
```

You can name the exact syscall/errno that was the problem (here `openat` → `ENOENT`), a skill
that transfers to any opaque binary.

## Hints

### Hint 1 — strace shows the syscall and the errno

`strace <cmd>` prints every system call and return value; failures show `= -1 ERRNO`. Narrow
the noise with `-e trace=...` (e.g. `openat,access,stat` for files; `connect,socket` for
network; `read,write` for I/O). Use `-f` to follow child processes and `-p <pid>` to attach to
a running one. The first `-1 E...` near the failure is usually your answer.

### Hint 2 — Common errnos map to concrete causes

`ENOENT` = missing file/path (config, library, socket). `EACCES`/`EPERM` = permissions.
`ECONNREFUSED` = nothing listening on the target port. `EADDRINUSE` = port taken.
`ETIMEDOUT`/blocking in `read` = a network/dependency hang. Save a full trace with
`strace -o trace.log -f -tt` and grep it. `ltrace` (library calls) and `-e trace=network`
help when the issue is above or below the syscall layer.

## Solution

Trace the program, read the failing syscall/errno, and fix what it points to.

```bash
# 1) find the failing syscall
strace -f -e trace=openat,access,stat,connect python3 mytool.py 2>&1 | grep -- '-1 '
# openat(... "/etc/mytool/config.ini" ...) = -1 ENOENT (No such file or directory)

# 2) fix the root cause revealed by the trace (here: create/point to the config)
sudo mkdir -p /etc/mytool
printf '[main]\nok = true\n' | sudo tee /etc/mytool/config.ini >/dev/null

# 3) verify
strace -e trace=openat python3 mytool.py 2>&1 | grep config.ini   # now = 3 (success)
python3 mytool.py; echo "exit=$?"                                 # exit=0
```

- **`strace` cuts through swallowed errors.** When an app exits non-zero with no message, the
  failing system call and its `errno` are visible at the kernel boundary regardless of what the
  app chooses to log.
- **Narrow with `-e trace=` and follow with `-f`.** Full traces are noisy; scoping to
  file/network/IO syscalls and following children gets you to the `-1 ERRNO` fast. `-o file -tt`
  saves a timestamped trace to grep.
- **Learn the common errnos**: `ENOENT` (missing path/lib/socket), `EACCES`/`EPERM`
  (permissions), `ECONNREFUSED` (nothing listening), `EADDRINUSE` (port taken), `ETIMEDOUT`/
  blocked `read` (hang). Each points to a concrete, different fix.
- **Attach to live processes with `-p <pid>`** to diagnose a hang in production — the last
  syscall before it blocked (often `read`, `futex`, or `connect`) tells you what it is waiting
  on. Beware strace's overhead on hot paths.
- **`ltrace` for library calls, `strace -e trace=network` for sockets** extend the same
  technique above and around the syscall layer. Together they turn "it just fails" into a
  precise, fixable fact.
