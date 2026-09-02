# The process the kernel killed for you

## Briefing

A service vanished. No crash in its logs, no `kill` you issued, just gone — exit code 137,
or simply absent. The machine was under memory pressure. The kernel's OOM killer terminated
it to save the system.

When Linux runs out of memory (and swap), the OOM killer picks a process and sends it
`SIGKILL`. It is not logged in the application (it never got a chance) — the record is in the
kernel ring buffer (`dmesg`) and the journal. The victim is chosen by an OOM score, which
you can influence.

## Your Task

- Reproduce (or read the evidence of) an OOM kill and confirm it was the kernel, not a
  crash.
- Find which process was killed and why it was chosen.
- Reduce the chance of the wrong process being killed next time.

## Starter Files

### file: hog.py

```python
# Allocates memory until the kernel steps in. Run in a VM/container you can afford to stress.
# Prefer to run it under a memory-limited cgroup/container so ONLY it is at risk.
data = []
chunk = b"x" * (50 * 1024 * 1024)   # 50 MB
while True:
    data.append(bytearray(chunk))    # grow resident memory forever
```

### file: notes.md

```text
Symptoms after the fact:
  - the service is gone; `systemctl status app` shows: Main process exited, code=killed, status=9/KILL
  - exit code 137 = 128 + 9 (SIGKILL)
  - the app's own logs end abruptly with no error
  - other processes may also have been affected
```

## Expected Failure

```bash
# after the process disappears:
dmesg -T | grep -i -E 'killed process|out of memory|oom'
# [Mon Aug 31 ...] Out of memory: Killed process 4821 (python3) total-vm:... anon-rss:...
# [Mon Aug 31 ...] oom-kill:constraint=..., task=python3, ...

systemctl status app 2>/dev/null | grep -i 'code='
# Main process exited, code=killed, status=9/KILL   <- SIGKILL, i.e. 137
```

The application logged nothing because it was killed with `SIGKILL`, which cannot be caught.
The truth is in `dmesg`/journal: "Out of memory: Killed process ...". Exit 137 (128+9)
confirms SIGKILL.

## Expected Outcome

You can attribute the kill and reduce its recurrence.

The kill is confirmed as OOM, with the victim and its size:

```bash
journalctl -k | grep -i 'out of memory'
# Out of memory: Killed process <pid> (<name>) ... anon-rss:<size>
```

Memory headroom is understood:

```bash
free -h
cat /proc/meminfo | grep -E 'MemAvailable|SwapFree'
```

Critical processes are protected (less likely to be chosen), and/or the real hog is
bounded:

```bash
# protect a critical PID from the OOM killer (lower is safer; -1000 = never)
cat /proc/<pid>/oom_score
sudo sh -c 'echo -900 > /proc/<pid>/oom_score_adj'
```

## Hints

### Hint 1 — OOM kills are in the kernel log, not the app

`SIGKILL` cannot be caught, so the application logs nothing. Look in `dmesg -T` /
`journalctl -k` for "Out of memory: Killed process". Exit status `137` (or systemd's
`status=9/KILL`) is the signature. Distinguish from a normal crash (traceback, non-137 exit)
and from a manual `kill -9`.

### Hint 2 — Influence the victim and remove the pressure

Each process has an OOM score (`/proc/<pid>/oom_score`) tunable via `oom_score_adj`
(-1000 = never kill, +1000 = kill first). Protect critical services; let the real hog be the
victim. Better: cap the hog's memory (systemd `MemoryMax=`, or a container limit) so it is
killed alone before the whole host is starved, and add swap for burst headroom.

## Solution

Confirm the OOM kill from the kernel log, identify the hog, then bound it and protect
critical processes.

```bash
# 1) confirm and attribute
journalctl -k | grep -i 'out of memory' | tail
dmesg -T | grep -i 'killed process' | tail

# 2) see the pressure
free -h; grep -E 'MemAvailable|SwapFree' /proc/meminfo

# 3) bound the hog so it dies alone, not the host (systemd example)
#    sudo systemctl set-property app.service MemoryMax=512M
#    or run it in a container with --memory=512m

# 4) protect a critical process from selection
sudo sh -c 'echo -900 > /proc/$(pgrep -f critical-service)/oom_score_adj'
```

- **OOM kills come from the kernel and use SIGKILL**, so the victim logs nothing. Exit 137
  (128+9) or systemd `status=9/KILL`, plus a `dmesg`/`journalctl -k` "Out of memory" line, is
  the definitive signature.
- **`SIGKILL` cannot be caught or cleaned up after** — which is why an OOM'd process leaves no
  graceful shutdown and often no partial work. Do not look in the app log for the cause; look
  in the kernel log.
- **The victim is chosen by OOM score**, roughly proportional to memory use and adjustable via
  `oom_score_adj`. Protect critical daemons (negative adj); do not blanket-protect everything
  or the kernel has no one to kill.
- **Bound the real consumer.** A per-service/container memory limit makes the hog get killed
  in isolation before the whole host is starved — far better than the kernel picking a random
  bystander. Swap adds burst headroom but does not fix a true leak.
- **Distinguish OOM from a crash from a manual kill**: crash = traceback / non-137 exit; OOM =
  kernel log + 137; manual = you (or an orchestrator) sent the signal. They need different
  fixes.
