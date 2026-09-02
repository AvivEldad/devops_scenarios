# Too many open files

## Briefing

A busy service starts failing with `Too many open files` / `EMFILE`, refusing new
connections or unable to open logs, while the machine has plenty of memory and CPU. Every
process has a limit on how many file descriptors it can hold, and this one hit it.

Sockets, pipes, and regular files all consume file descriptors. The per-process soft limit
(`ulimit -n`) is often low by default. Either the limit is too low for a legitimately busy
service, or the application is *leaking* descriptors (opening without closing).

## Your Task

- Reproduce `Too many open files` by exhausting descriptors under a low limit.
- Determine whether the limit is too low or the app is leaking.
- Fix the right one: raise the limit properly, or stop the leak.

## Starter Files

### file: leaky.py

```python
# Opens files without closing them -> descriptor leak.
import time
open_files = []
i = 0
while True:
    f = open("/dev/null", "r")   # never closed -> leaks an fd each iteration
    open_files.append(f)
    i += 1
    if i % 100 == 0:
        print(f"open fds held: {i}", flush=True)
    time.sleep(0.001)
```

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "current soft limit: $(ulimit -Sn)   hard limit: $(ulimit -Hn)"
echo "run under a low limit to trigger it fast:"
echo "   ( ulimit -Sn 256; python3 leaky.py )"
```

## Expected Failure

```bash
bash setup.sh
( ulimit -Sn 256; python3 leaky.py )
# open fds held: 100
# open fds held: 200
# Traceback (most recent call last):
#   OSError: [Errno 24] Too many open files: '/dev/null'
```

```bash
# while a similar service runs, inspect its fd usage:
ls /proc/<pid>/fd | wc -l          # count of open descriptors
cat /proc/<pid>/limits | grep 'open files'
# Max open files   1024   1024   files
```

The process hit its per-process descriptor ceiling. The count in `/proc/<pid>/fd` climbing
steadily (and never dropping) is the signature of a *leak*; a high but stable count under
real load points instead to a *limit too low*.

## Expected Outcome

The service holds descriptors sustainably.

If it was a leak: the fd count stays bounded over time.

```bash
watch -n2 'ls /proc/<pid>/fd | wc -l'
# stays flat instead of climbing forever
```

If the limit was genuinely too low: it is raised where the service actually reads it.

```bash
cat /proc/<pid>/limits | grep 'open files'
# Max open files   65536   65536   files

# for a systemd service, the durable place:
#   [Service]
#   LimitNOFILE=65536
```

## Hints

### Hint 1 — Count the fds and watch the trend

`ls /proc/<pid>/fd | wc -l` counts open descriptors; `cat /proc/<pid>/limits` shows the
ceiling. Watch the count over time: steadily climbing = a leak (fix the code); high but
stable near the limit = raise the limit. `lsof -p <pid>` shows *what* is open, which reveals
the leak's source (same file/socket thousands of times).

### Hint 2 — Raise the limit in the right place

`ulimit -n` only affects the current shell and its children. For a service, set it where the
service starts: systemd `LimitNOFILE=`, or `/etc/security/limits.conf` for login sessions,
plus the hard limit must be ≥ the soft limit. Raising the limit does NOT fix a leak — it just
delays the failure. Diagnose which problem you have first.

## Solution

Determine leak vs limit, then fix accordingly.

```bash
# 1) is it leaking? watch the count
watch -n2 'ls /proc/<pid>/fd | wc -l'
lsof -p <pid> | awk '{print $NF}' | sort | uniq -c | sort -rn | head   # what is open a lot

# 2a) leak -> fix the code (close files/sockets; use context managers)
#     Python:  with open(path) as f: ...      (auto-closes)

# 2b) limit genuinely too low -> raise it where the service starts
#     systemd:            [Service]\nLimitNOFILE=65536   then daemon-reload + restart
#     login sessions:     /etc/security/limits.conf:  user  soft nofile 65536
#                                                      user  hard nofile 65536
#     current shell test: ulimit -Sn 65536
```

- **Everything is a file descriptor** — regular files, sockets, pipes, epoll instances. A
  busy network service can hold thousands legitimately; the default 1024 is often too low.
- **Leak vs limit is the key diagnosis.** `/proc/<pid>/fd` climbing without bound = a leak
  (the app opens without closing); stable-but-high near the ceiling = the limit is too low.
  `lsof -p` shows what is being held so you can spot the repeated resource.
- **Raising the limit does not fix a leak** — it postpones the crash and can make the
  eventual failure worse. Fix the code (close descriptors; use `with`/RAII); raise limits only
  for genuinely high-concurrency services.
- **Set limits where the process starts.** `ulimit` is shell-local; services need systemd
  `LimitNOFILE=` or PAM `limits.conf`. The hard limit caps the soft limit, so raise both.
- **`/proc/<pid>/limits` is ground truth** for what a running process actually has — more
  reliable than assuming your shell's `ulimit` applied to it.
